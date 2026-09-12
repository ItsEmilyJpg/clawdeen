import { open, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { glob } from 'node:fs/promises'

import { TASKS, TRANSCRIPTS } from './paths'

/** What announces a background task: a monitor, an agent and a backgrounded command all say it differently. */
const TASK_STARTED =
  /running in background with ID: ([a-z0-9]+)|Monitor started \(task ([a-z0-9]+)|"agentId"\s*:\s*"([\w-]+)"/g
/** What ends one. The same notification carries a monitor event, which is why the status is read too. */
const TASK_ENDED = /<task-id>([\w-]+)<\/task-id>[\s\S]{0,600}?<status>(\w+)<\/status>/g
const TASK_OVER = new Set(['completed', 'failed', 'killed', 'stopped'])
/** A tool call that is not work in progress but a question, so the session stands on her answer. */
const ASKING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
/** Tools that are a wait rather than work: the session is parked on something else finishing. */
const WAITING_TOOLS = new Set(['TaskOutput', 'Monitor'])
const TAIL_BYTES = 64 * 1024

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

interface Entry {
  type?: string
  isSidechain?: boolean
  message?: { stop_reason?: string; content?: { type?: string; name?: string }[] }
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
    // A user entry is either a tool coming back or something she typed; in both the turn is in
    // flight, and reading it as finished is what made a working session look like a waiting one.
    if (entry.type === 'user') return 'running'
    if (message.stop_reason !== 'tool_use') return 'ended'
    const names = (message.content ?? []).map((part) => part?.name).filter(Boolean) as string[]
    if (names.some((name) => ASKING_TOOLS.has(name))) return 'asking'
    return names.some((name) => WAITING_TOOLS.has(name)) ? 'blocked' : 'running'
  }
  return 'ended'
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

/** What has been read of one transcript, so a sweep reads the new bytes and not the whole file. */
interface Tally {
  offset: number
  started: Set<string>
  ended: Set<string>
  /** Which of them are monitors: a monitor exists to wait, so it never counts as work being done. */
  monitors: Set<string>
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

export async function pendingWork(
  cli: string,
  path: string,
  said?: { queueing: RegExp | null; running: RegExp | null }
): Promise<Pending | null> {
  const outputs = await taskFiles(cli)
  if (outputs.size === 0) return null
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
    tally = { offset: 0, started: new Set(), ended: new Set(), monitors: new Set(), rest: '' }
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
      for (const match of whole.matchAll(TASK_STARTED)) {
        const id = match[1] ?? match[2] ?? match[3]
        if (!id) continue
        tally.started.add(id)
        if (match[2]) tally.monitors.add(id)
      }
      for (const [, task, status] of whole.matchAll(TASK_ENDED)) {
        if (TASK_OVER.has(status)) tally.ended.add(task)
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
    try {
      const seen = await stat(output)
      wrote = seen.mtimeMs / 1000
      born = (seen.birthtimeMs || seen.mtimeMs) / 1000
    } catch {
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
    if (now - wrote >= QUIET) continue
    // A check says in its own output which of the two it is, queueing or running.
    const tail = said?.queueing || said?.running ? await lastOf(output) : ''
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
export async function watchedFor(path: string): Promise<string | null> {
  const lines = (await tail(path)).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes('"name":"Monitor"')) continue
    const found = /#(\d{1,6})/.exec(lines[index])
    return found ? `#${found[1]}` : null
  }
  return null
}

export async function modified(path: string): Promise<number> {
  return (await stat(path)).mtimeMs / 1000
}
