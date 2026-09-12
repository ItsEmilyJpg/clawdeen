import { open } from 'node:fs/promises'

import type { Line } from '../shared/types'

/** Enough of the tail for a long conversation without reading a transcript that can be sixty megabytes. */
const TAIL_BYTES = 512 * 1024
const KEPT = 60
const LONGEST = 1800
/** Everything the harness injects around what a person actually wrote. */
const INJECTED =
  /<system-reminder>[\s\S]*?<\/system-reminder>|<task-notification>[\s\S]*?<\/task-notification>|\[SYSTEM NOTIFICATION[^\]]*\][^\n]*/g

interface Part {
  type?: string
  text?: string
  name?: string
}

interface Entry {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { role?: string; content?: Part[] | string }
}

function textOf(content: Part[] | string | undefined): string {
  const whole =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((part) => part.type === 'text' && part.text)
          .map((part) => part.text as string)
          .join('\n')
  // A plain string carries the injected blocks as often as a list of parts does, so both are cleaned.
  return whole
    .replace(INJECTED, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toolsOf(content: Part[] | string | undefined): string[] {
  if (typeof content === 'string') return []
  return (content ?? [])
    .filter((part) => part.type === 'tool_use' && part.name)
    .map((part) => part.name as string)
}

/** The conversation as it reads: what was said, with the tool calls named but not unfolded. */
export async function chat(path: string): Promise<Line[]> {
  const handle = await open(path, 'r')
  let tail: string
  try {
    const size = (await handle.stat()).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, size - length))
    tail = buffer.toString('utf8')
  } finally {
    await handle.close()
  }

  const lines: Line[] = []
  for (const raw of tail.split('\n')) {
    let entry: Entry
    try {
      entry = JSON.parse(raw) as Entry
    } catch {
      continue
    }
    if (entry.isSidechain || (entry.type !== 'user' && entry.type !== 'assistant')) continue
    const text = textOf(entry.message?.content)
    const tools = entry.type === 'assistant' ? toolsOf(entry.message?.content) : []
    // A user entry with no text of its own is a tool result coming back, not something she said.
    if (!text && tools.length === 0) continue
    const cut = text.length > LONGEST ? `${text.slice(0, LONGEST)}…` : text
    const last = lines.at(-1)
    // One answer is written as many entries, one per tool call; they read as a single turn.
    if (last && last.role === 'assistant' && entry.type === 'assistant') {
      last.text = [last.text, cut].filter(Boolean).join('\n\n')
      last.tools = [...last.tools, ...tools]
      continue
    }
    lines.push({
      role: entry.type,
      at: entry.timestamp ? Date.parse(entry.timestamp) / 1000 : 0,
      text: cut,
      tools
    })
  }
  return lines.slice(-KEPT)
}
