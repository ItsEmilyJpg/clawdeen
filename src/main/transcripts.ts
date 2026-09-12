import { open, readFile, stat } from 'node:fs/promises'
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
const TAIL_BYTES = 64 * 1024

export type Turn = 'ended' | 'asking' | 'running'

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
    if (entry.type !== 'assistant' || message.stop_reason !== 'tool_use') return 'ended'
    const asked = (message.content ?? []).some((part) => part?.name && ASKING_TOOLS.has(part.name))
    return asked ? 'asking' : 'running'
  }
  return 'ended'
}

async function taskFiles(cli: string): Promise<string[]> {
  const found: string[] = []
  for await (const path of glob(join(TASKS, '*', cli, 'tasks', '*.output'))) found.push(path)
  return found
}

/**
 * A monitor watching an issue writes nothing for hours, so what counts is a task that started and
 * never got its notification, not a file that stopped growing. The task directory is the cheap half:
 * a session that never backgrounded anything is out before the transcript is read at all.
 */
export async function pendingWork(cli: string, path: string): Promise<boolean> {
  if ((await taskFiles(cli)).length === 0) return false
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return false
  }
  const started = new Set<string>()
  for (const match of text.matchAll(TASK_STARTED)) {
    const id = match[1] ?? match[2] ?? match[3]
    if (id) started.add(id)
  }
  for (const [, task, status] of text.matchAll(TASK_ENDED)) {
    if (TASK_OVER.has(status)) started.delete(task)
  }
  return started.size > 0
}

export async function modified(path: string): Promise<number> {
  return (await stat(path)).mtimeMs / 1000
}
