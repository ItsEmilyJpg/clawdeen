import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'node:fs/promises'

import { APP_CONFIG, SESSIONS } from './paths'

/** One session as the desktop app stores it. Only the fields this application reads are named. */
export interface SessionRecord {
  sessionId: string
  cliSessionId?: string
  priorCliSessionIds?: string[]
  title?: string
  cwd?: string
  originCwd?: string
  worktreePath?: string
  worktreeName?: string
  branch?: string
  writtenBranches?: string[]
  prs?: { prNumber?: number; repo?: string; url?: string; state?: string; branch?: string }[]
  lastActivityAt?: number
  lastFocusedAt?: number
  isArchived?: boolean
  isStarred?: boolean
}

export const WINDOW_SECONDS = 7 * 86400

/** Every account that ever signed in keeps its records on disk, but the sidebar lists only the current one. */
async function signedInAccount(): Promise<string> {
  try {
    const config = JSON.parse(await readFile(APP_CONFIG, 'utf8')) as {
      lastKnownAccountUuid?: unknown
    }
    if (typeof config.lastKnownAccountUuid === 'string' && config.lastKnownAccountUuid) {
      return config.lastKnownAccountUuid
    }
    console.warn(`${APP_CONFIG}: no lastKnownAccountUuid, listing every account`)
  } catch (error) {
    console.warn(`${APP_CONFIG}: ${(error as Error).name}, listing every account`)
  }
  return '*'
}

export async function records(now: number): Promise<SessionRecord[]> {
  const account = await signedInAccount()
  const found = new Map<string, SessionRecord>()
  for await (const path of glob(join(SESSIONS, account, '*', '*.json'))) {
    let record: SessionRecord
    try {
      record = JSON.parse(await readFile(path, 'utf8')) as SessionRecord
    } catch (error) {
      console.warn(`skipped ${path}: ${(error as Error).name}`)
      continue
    }
    if (!record.sessionId || record.isArchived) continue
    if (now - (record.lastActivityAt ?? 0) / 1000 > WINDOW_SECONDS) continue
    // The same session can sit in two account folders once it has been copied between logins, and
    // then only the newer copy is the one worth showing.
    const twin = found.get(record.sessionId)
    if (!twin || (twin.lastActivityAt ?? 0) < (record.lastActivityAt ?? 0)) {
      found.set(record.sessionId, record)
    }
  }
  return [...found.values()]
}

/**
 * Which session is open in the Claude app. The app stamps `lastFocusedAt` when a card is focused
 * rather than when the session does anything, so the highest of them is the one on her screen, and
 * no record carrying the field at all means nothing is claimed.
 */
export function openSession(found: SessionRecord[]): string | null {
  let open: SessionRecord | null = null
  for (const record of found) {
    if (!record.lastFocusedAt) continue
    if (!open || (open.lastFocusedAt ?? 0) < record.lastFocusedAt) open = record
  }
  return open?.sessionId ?? null
}

export function branches(record: SessionRecord): string[] {
  const ordered = [...(record.writtenBranches ?? [])].reverse()
  if (record.branch) ordered.push(record.branch)
  return [...new Set(ordered.filter((branch): branch is string => Boolean(branch)))]
}
