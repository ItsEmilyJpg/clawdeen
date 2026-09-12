import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { glob } from 'node:fs/promises'

import { TASKS, TRANSCRIPTS } from './paths'

/**
 * What announces a task of this session: the harness prints where its output is going, and that path
 * carries the session's own id. Matching the wording alone counted every id the session ever quoted
 * from somebody else's transcript, which is how a session came to be waiting for twenty tasks that
 * were never its own.
 */
const started = (cli: string): RegExp => new RegExp(`/${cli}/tasks/([a-z0-9]+)\\.output`, 'g')
/** A monitor names no path, only the task it became. */
const MONITOR_STARTED = /Monitor started \(task ([a-z0-9]+)/
const TASK_ENDED = /<task-id>([\w-]+)<\/task-id>[\s\S]{0,600}?<status>(\w+)<\/status>/g
const TASK_OVER = new Set(['completed', 'failed', 'killed', 'stopped'])
/** A tool call that is not work in progress but a question, so the session stands on her answer. */
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
/** Tools that are a wait rather than work: the session is parked on something else finishing. */
const WAITING_TOOLS = new Set(['TaskOutput', 'Monitor'])
const TAIL_BYTES = 64 * 1024
/** Where a command says it runs: the two ways this machine's sessions name a directory. */
const CD = /(?:^|[;&|(]\s*|&&\s*)cd\s+(?:--\s+)?('[^']+'|"[^"]+"|[^\s;&|<>]+)/g
const GIT_C = /\bgit\s+(?:-c\s+\S+\s+)*-C\s+('[^']+'|"[^"]+"|[^\s;&|<>]+)/g
/** A path the shell computes says nothing here, and neither does one that only moves about. */
const COMPUTED = /[$*`?{]/
const NOWHERE = new Set(['-', '.', '..'])
/** How many named directories are kept, so the newest that is a working copy has something behind it. */
const KEPT = 20
/** How far the first pass looks back. In the last 64 KB half the transcripts name no directory at all. */
const NAMED_BYTES = 256 * 1024

export type Turn = 'ended' | 'asking' | 'running' | 'blocked'
/** A task of the session's own: one that is writing, or one that is only waiting for something. */
export type Doing = 'working' | 'waiting' | 'watching' | 'queued' | 'gating'

/** Transcript path by CLI session id. The directory is named after the working copy, so only the file matches. */
export async function transcripts(): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  for await (const path of glob(join(TRANSCRIPTS, '*', '*.jsonl'))) {
    index.set(basename(path).replace(/\.jsonl$/, ''), path)
  }
  return index
}

async function tail(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

interface Part {
  type?: string
  name?: string
  id?: string
  tool_use_id?: string
  content?: unknown
  input?: { command?: unknown }
}

interface Entry {
  type?: string
  isSidechain?: boolean
  message?: {
    stop_reason?: string
    content?: string | Part[]
  }
}

/** The parts of one entry, where it has them: a transcript writes a plain answer as a string. */
function parts(entry: Entry): Part[] {
  const content = entry.message?.content
  return Array.isArray(content) ? content : []
}

/**
 * The last entry of the main thread says which of the three it is: a tool still running, a question
 * nobody has answered, or a turn that ended.
 */
export async function lastTurn(path: string): Promise<Turn> {
  const lines = (await tail(path)).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry: Entry
    try {
      entry = JSON.parse(lines[index]) as Entry
    } catch {
      continue
    }
    if (entry.isSidechain || (entry.type !== 'assistant' && entry.type !== 'user')) continue
    const message = entry.message ?? {}
    if (entry.type === 'user') {
      // A task notification arrives as a user turn nobody typed: it is the harness saying something
      // finished, not a session in flight, and reading it as work is what had an idle session busy.
      const text =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      if (text.includes('<task-notification>')) continue
      // Anything else from the user is a tool coming back or something she typed, and both mean the
      // turn is in flight.
      return 'running'
    }
    if (message.stop_reason !== 'tool_use') return 'ended'
    const names = parts(entry)
      .map((part) => part?.name)
      .filter(Boolean) as string[]
    if (names.some((name) => ASKING_TOOLS.has(name))) return 'asking'
    return names.some((name) => WAITING_TOOLS.has(name)) ? 'blocked' : 'running'
  }
  return 'ended'
}

/** Whether the session ever backgrounded anything, which a monitor that has printed nothing has. */
async function hasTasks(cli: string): Promise<boolean> {
  for await (const directory of glob(join(TASKS, '*', cli, 'tasks'))) return Boolean(directory)
  return false
}

/** The output of every task this session started, by the id the file is named after. */
async function taskFiles(cli: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  for await (const path of glob(join(TASKS, '*', cli, 'tasks', '*.output'))) {
    found.set(basename(path).replace(/\.output$/, ''), path)
  }
  return found
}

/**
 * How a task's own output says it is over. The notification that says the same does not always reach
 * the transcript, and a row then waited on a command that had long finished. Anchored to the end and
 * spelled out rather than "anything in brackets": of 722 outputs on this machine 635 ended with an
 * exit code, 44 with the kill, 42 with nothing at all, and one with a bracket of its own making.
 */
const ENDED = /\[(?:killed|exited with code \d+)\]\s*$/

/**
 * A task that has written nothing for this long is waiting for something rather than doing it: a
 * watcher polling for a free machine looks exactly like a compile that has gone quiet, and five
 * minutes is longer than anything of ours stays silent while it works.
 */
const QUIET = 300
/**
 * How far a task may fall behind the session that started it before it stops counting. A session
 * that has been talking for an hour is not waiting for something that has been silent all that time.
 */
const DEAD = 3600

/**
 * A command that is itself a wait: a loop that sleeps until something else is over, or a bare sleep.
 * Such a task is waiting from its first second, however often the loop wakes up to print.
 */
const WAITING_COMMAND = /\b(?:until|while)\b[\s\S]*?\bdo\b[\s\S]*?\bsleep\b|(?:^|[;&|]\s*)sleep\s/
/** How the harness names the task it just put in the background, in the result of the call itself. */
const BACKGROUNDED = /background with ID: ([a-z0-9]+)/

/** What has been read of one transcript, so a sweep reads the new bytes and not the whole file. */
interface Tally {
  offset: number
  started: Set<string>
  ended: Set<string>
  /** Which of them are monitors: a monitor exists to wait, so it never counts as work being done. */
  monitors: Set<string>
  /** And which of them are waits by the look of the command that started them. */
  waits: Set<string>
  /** Calls that were a wait of either kind, until the result says which task id they became. */
  waiters: Map<string, 'wait' | 'monitor'>
  rest: string
}

const tallies = new Map<string, Tally>()

/**
 * A monitor watching an issue writes nothing for hours, so what counts is a task that started and
 * never got its notification, not a file that stopped growing. The task directory is the cheap half:
 * a session that never backgrounded anything is out before the transcript is read at all, and what
 * is read is only what has been appended since the last pass.
 */
export interface Pending {
  doing: Doing
  /** When the oldest task still standing was started, so a row can say how long it has been on. */
  since: number | null
}

/**
 * The tasks this stretch of transcript started that are waits rather than work: a monitor, which
 * exists to wait, and a command that is one. What names the task is the result of the call and what
 * says which of the two it is is the call itself, so the call's own id joins them, and a half-seen
 * pair is carried between reads because the two land in different sweeps.
 *
 * The pairing is also what keeps somebody else's task out: a transcript the session merely read
 * quotes the same wording, and matching that wording alone once had a session waiting on twenty
 * tasks that were never its own.
 */
function backgrounded(
  text: string,
  waiters: Map<string, 'wait' | 'monitor'>
): { waits: string[]; monitors: string[] } {
  const waits: string[] = []
  const monitors: string[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    // An agent of its own waits on its own account, and its tasks are not this session's.
    if (entry.isSidechain) continue
    for (const part of parts(entry)) {
      if (part.type === 'tool_use') {
        if (!part.id) continue
        if (part.name === 'Monitor') waiters.set(part.id, 'monitor')
        const command = part.input?.command
        if (part.name === 'Bash' && typeof command === 'string' && WAITING_COMMAND.test(command))
          waiters.set(part.id, 'wait')
        continue
      }
      if (part.type !== 'tool_result' || !part.tool_use_id) continue
      const kind = waiters.get(part.tool_use_id)
      if (!kind) continue
      waiters.delete(part.tool_use_id)
      const said = typeof part.content === 'string' ? part.content : JSON.stringify(part.content)
      const named = (kind === 'monitor' ? MONITOR_STARTED : BACKGROUNDED).exec(said)
      if (named) (kind === 'monitor' ? monitors : waits).push(named[1])
    }
  }
  return { waits, monitors }
}

export async function pendingWork(
  cli: string,
  path: string,
  said?: { queueing: RegExp | null; running: RegExp | null }
): Promise<Pending | null> {
  const outputs = await taskFiles(cli)
  if (outputs.size === 0 && !(await hasTasks(cli))) return null
  let size: number
  let moved: number
  try {
    const seen = await stat(path)
    size = seen.size
    moved = seen.mtimeMs / 1000
  } catch {
    return null
  }
  let tally = tallies.get(path)
  // A transcript that shrank is a different file under the same name; what was counted no longer holds.
  if (!tally || tally.offset > size) {
    tally = {
      offset: 0,
      started: new Set(),
      ended: new Set(),
      monitors: new Set(),
      waits: new Set(),
      waiters: new Map(),
      rest: ''
    }
    tallies.set(path, tally)
  }
  if (size > tally.offset) {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(size - tally.offset)
      await handle.read(buffer, 0, buffer.length, tally.offset)
      // The tail can stop mid line, so what is left over is carried into the next read.
      const text = tally.rest + buffer.toString('utf8')
      const stop = text.lastIndexOf('\n')
      const whole = stop === -1 ? '' : text.slice(0, stop)
      tally.rest = stop === -1 ? text : text.slice(stop + 1)
      tally.offset = size
      for (const [, id] of whole.matchAll(started(cli))) tally.started.add(id)
      for (const [, task, status] of whole.matchAll(TASK_ENDED)) {
        if (TASK_OVER.has(status)) tally.ended.add(task)
      }
      const { waits, monitors } = backgrounded(whole, tally.waiters)
      for (const task of waits) tally.waits.add(task)
      // A monitor writes nothing until it has something to say, so it has no file to be found by
      // and the pairing above is the whole of what knows it is this session's.
      for (const task of monitors) {
        tally.started.add(task)
        tally.monitors.add(task)
      }
    } finally {
      await handle.close()
    }
  }
  for (const id of tally.ended) tally.started.delete(id)
  if (tally.started.size === 0) return null

  const now = Date.now() / 1000
  let live = 0
  let commands = 0
  let fresh = false
  let since: number | null = null
  let freshSince: number | null = null
  let queued: Pending | null = null
  for (const id of tally.started) {
    const output = outputs.get(id)
    // A task that has printed nothing has no file at all yet, which is not a reason to forget it:
    // the watcher that says "No output yet" for two hours is exactly the one worth a row.
    if (!output) {
      live += 1
      if (!tally.monitors.has(id)) commands += 1
      continue
    }
    let wrote: number
    let born: number
    let printed: boolean
    try {
      const seen = await stat(output)
      wrote = seen.mtimeMs / 1000
      born = (seen.birthtimeMs || seen.mtimeMs) / 1000
      printed = seen.size > 0
    } catch {
      continue
    }
    const tail = await lastOf(output)
    // A task that has ended says so at the end of its own output, whether or not the notification
    // saying the same ever arrived.
    if (ENDED.test(tail)) {
      tally.ended.add(id)
      continue
    }
    // A command that has said nothing for an hour while the session kept moving was killed, or its
    // notification was lost, unless a process is still holding its output: then it is simply quiet.
    // A monitor is not judged this way at all, it writes nothing by design.
    if (!tally.monitors.has(id) && moved - wrote > DEAD) continue
    live += 1
    since = since === null ? born : Math.min(since, born)
    if (tally.monitors.has(id)) continue
    commands += 1
    // A file with nothing in it stamps when it was made, not when the task last said something, so
    // the quiet rule would read the making of it as work for as long as it takes to go quiet.
    if (!printed || tally.waits.has(id)) continue
    if (now - wrote >= QUIET) continue
    // A check says in its own output which of the two it is, queueing or running.
    if (said?.queueing?.test(tail)) queued = { doing: 'queued', since: born }
    else if (said?.running?.test(tail)) queued = { doing: 'gating', since: born }
    else {
      // The row says how long the task that is actually writing has been on, not how long the
      // oldest thing in the session has been standing around.
      fresh = true
      freshSince = freshSince === null ? born : Math.min(freshSince, born)
    }
  }
  if (queued) return queued
  if (live === 0) return null
  if (fresh) return { doing: 'working', since: freshSince ?? since }
  // Only monitors left: those wait for something outside this session, an issue or another session.
  return { doing: commands === 0 ? 'watching' : 'waiting', since }
}

/** The end of a task's output, which is where it says what it is waiting for. */
async function lastOf(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const length = Math.min(size, 2048)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/**
 * What a monitor is watching, read off the call that started it: the description and the command
 * both tend to name an issue, and that number is the whole point of the row saying it waits.
 */
export interface Watched {
  /** What it is watching: a run, an issue, or something this cannot name. */
  kind: 'ci' | 'issue' | 'other'
  /** The number it names, where it names one. */
  about: string | null
}

export async function watchedFor(path: string): Promise<Watched | null> {
  const lines = (await tail(path)).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line.includes('"name":"Monitor"')) continue
    const found = /#(\d{1,6})/.exec(line)
    // What a monitor watches is in the command it was given: a run has checks in it, an issue is
    // asked for by name.
    const kind = /checks|statusCheck|\bCI\b|workflow run/i.test(line)
      ? 'ci'
      : /issue (view|list)|--json state/i.test(line)
        ? 'issue'
        : 'other'
    return { kind, about: found ? `#${found[1]}` : null }
  }
  return null
}

export async function modified(path: string): Promise<number> {
  return (await stat(path)).mtimeMs / 1000
}

/** The directories one transcript has named, oldest first, and how far it has been read. */
interface Named {
  offset: number
  rest: string
  paths: string[]
}

const named = new Map<string, Named>()

/**
 * The commands the session ran, which is the only place a directory may be read from. A transcript
 * carries the files the session read as well, and those quote `cd` and `git -C` themselves: matching
 * the text alone had this very session working in a directory it had only ever printed.
 */
function commands(text: string): string[] {
  const found: string[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    // An agent of its own works somewhere else by design, so what it names is not the session's.
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    for (const part of parts(entry)) {
      if (part?.type !== 'tool_use' || part.name !== 'Bash') continue
      if (typeof part.input?.command === 'string') found.push(part.input.command)
    }
  }
  return found
}

/** The directories one command names, in the order it names them. */
function directories(command: string, from: string): string[] {
  const found: { at: number; path: string }[] = []
  for (const pattern of [CD, GIT_C]) {
    for (const match of command.matchAll(pattern)) {
      const said = match[1].replace(/^['"]|['"]$/g, '')
      if (COMPUTED.test(said) || NOWHERE.has(said)) continue
      const path = said.startsWith('~/') ? join(homedir(), said.slice(2)) : said
      if (!isAbsolute(path) && !from) continue
      found.push({ at: match.index, path: isAbsolute(path) ? path : resolve(from, path) })
    }
  }
  return found.sort((one, other) => one.at - other.at).map((one) => one.path)
}

/**
 * Every directory the session's own commands have named, newest first. A relative one is read against
 * the copy the session was opened in, which is where the harness starts every command.
 */
export async function touchedPaths(path: string, from: string): Promise<string[]> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return []
  }
  let seen = named.get(path)
  // A transcript that shrank is a different file under the same name; what was read no longer holds.
  if (!seen || seen.offset > size) {
    seen = { offset: Math.max(0, size - NAMED_BYTES), rest: '', paths: [] }
    named.set(path, seen)
  }
  if (size > seen.offset) {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(size - seen.offset)
      await handle.read(buffer, 0, buffer.length, seen.offset)
      const text = seen.rest + buffer.toString('utf8')
      const stop = text.lastIndexOf('\n')
      seen.rest = stop === -1 ? text : text.slice(stop + 1)
      seen.offset = size
      for (const command of commands(stop === -1 ? '' : text.slice(0, stop))) {
        for (const directory of directories(command, from)) {
          seen.paths = [...seen.paths.filter((kept) => kept !== directory), directory].slice(-KEPT)
        }
      }
    } finally {
      await handle.close()
    }
  }
  return [...seen.paths].reverse()
}
