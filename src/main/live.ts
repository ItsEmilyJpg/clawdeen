import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

import { LIVE } from './paths'

/** What a hook tells the board, before any of it reaches a file. */
export type Live = 'working' | 'asking' | 'ended'

const EVENTS: { [key: string]: Live } = {
  SessionStart: 'working',
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  Notification: 'asking',
  Stop: 'ended'
}

/** Nothing older than this is trusted: a hook that stopped arriving leaves the files to answer. */
const TRUSTED = 6 * 3600

const heard = new Map<string, { live: Live; at: number }>()

export function liveState(cli: string, now: number): Live | null {
  const held = heard.get(cli)
  if (!held || now - held.at > TRUSTED) return null
  return held.live
}

export function liveAt(cli: string): number | null {
  return heard.get(cli)?.at ?? null
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
    // A hook payload is a few kilobytes; anything larger is not one.
    if (chunks.reduce((sum, part) => sum + part.length, 0) > 256 * 1024) break
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A listener the Claude hooks post to, so a session says what it is doing instead of being guessed
 * at from its files. It lives on the loopback with a token beside it, and reading the files stays
 * the fallback for everything it does not hear.
 */
export async function listen(changed: () => void): Promise<void> {
  const token = randomBytes(24).toString('hex')
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (request.method !== 'POST' || request.headers['x-board-token'] !== token) {
        response.writeHead(404).end()
        return
      }
      try {
        const payload = JSON.parse(await readBody(request)) as {
          session_id?: string
          hook_event_name?: string
        }
        const live = EVENTS[payload.hook_event_name ?? '']
        if (payload.session_id && live) {
          heard.set(payload.session_id, { live, at: Date.now() / 1000 })
          changed()
        }
      } catch {
        // A payload that is not a hook is not worth a line in the log.
      }
      response.writeHead(204).end()
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') return
  await mkdir(dirname(LIVE), { recursive: true })
  await writeFile(LIVE, JSON.stringify({ port: address.port, token }), { mode: 0o600 })
  console.log(`live events on 127.0.0.1:${address.port}`)
}
