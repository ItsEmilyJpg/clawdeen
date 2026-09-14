import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { promisify } from 'node:util'

import { say, type PhraseKey } from '../shared/i18n'
import type { UsageWindow } from '../shared/types'
import { burnOf } from '../shared/words'
import { CLI_CONFIG, USAGE, USAGE_REFRESH } from './paths'

const run = promisify(execFile)

const TTL = 900
// Two refresh cycles missed: one is the normal gap, two means the number is standing still.
const STALE = TTL * 2
// The long label is said when a board is built, so it follows the language like everything else.
const WINDOWS: [string, PhraseKey, string][] = [
  ['five_hour', 'windowFiveHour', '5 h'],
  ['seven_day', 'windowSevenDay', '7 d']
]

interface StoredWindow {
  used_percentage?: number
  resets_at?: number
  duration_minutes?: number
}

interface Stored {
  captured_at?: number
  /** Whose numbers these are, stamped by the refresh script; absent on a cache written before it. */
  account?: string
  /** What the last refresh failed on, left there by the same script. */
  error?: string
  [key: string]: StoredWindow | string | number | undefined
}

async function stored(): Promise<Stored> {
  try {
    return JSON.parse(await readFile(USAGE, 'utf8')) as Stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`${USAGE}: ${(error as Error).name}`)
    return {}
  }
}

let account: { at: number; name: string | null } | null = null

/**
 * The account the CLI is logged into, remembered until its file changes.
 *
 * Re-parsing a 130 kB file on every board refresh to answer a question that changes twice a year
 * is the kind of thing that makes a board feel slow for no reason.
 */
async function cliAccount(): Promise<string | null> {
  let at: number
  try {
    at = (await stat(CLI_CONFIG)).mtimeMs
  } catch {
    return null
  }
  if (account && account.at === at) return account.name
  let name: string | null = null
  try {
    const config = JSON.parse(await readFile(CLI_CONFIG, 'utf8')) as {
      oauthAccount?: { emailAddress?: string; organizationName?: string }
    }
    const { emailAddress, organizationName } = config.oauthAccount ?? {}
    // The same shape the refresh script stamps into the cache, or the comparison never matches.
    if (emailAddress)
      name = organizationName ? `${emailAddress} · ${organizationName}` : emailAddress
  } catch {
    name = null
  }
  account = { at, name }
  return name
}

export async function usage(now: number): Promise<UsageWindow[]> {
  let data = await stored()
  // Written by the terminal statusline, so a day spent in the app alone leaves it standing still.
  if (now - (data.captured_at ?? 0) > TTL) {
    try {
      await run('python3', [USAGE_REFRESH], { timeout: 20_000 })
      data = await stored()
    } catch (error) {
      console.warn(`${USAGE_REFRESH}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  // The script exits zero on a failed refresh and leaves the reason behind, so the exit code above
  // says nothing. Whether the numbers are current is only readable here.
  const failed = typeof data.error === 'string' ? data.error : null
  const stamped = typeof data.account === 'string' ? data.account : null
  const current = stamped ? await cliAccount() : null
  const otherAccount = stamped && current && stamped !== current ? stamped : null
  const windows: UsageWindow[] = []
  for (const [key, phrase, short] of WINDOWS) {
    const window = data[key]
    if (typeof window !== 'object' || !window) continue
    const { used_percentage: used, resets_at: resets, duration_minutes: minutes } = window
    if (used === undefined || !resets || !minutes) continue
    // Spent against the share of the window that is gone: above one is faster than it refills.
    const gone = Math.min(1, Math.max(0, 1 - (resets - now) / (minutes * 60)))
    const left = Math.max(0, resets - now)
    const age = now - (data.captured_at ?? 0)
    windows.push({
      key,
      label: say(phrase),
      short,
      used,
      resets,
      left,
      pace: gone > 0.05 ? used / (gone * 100) : null,
      burn: burnOf(used, left, minutes),
      // A failed refresh makes any age worth saying: the number is not standing still by chance.
      stale: age > STALE || (failed !== null && age > TTL) ? age : null,
      error: failed,
      otherAccount
    })
  }
  return windows
}
