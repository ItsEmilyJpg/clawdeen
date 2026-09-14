import { app } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { say, type PhraseKey } from '../shared/i18n'
import type { Spend, UsageWindow } from '../shared/types'
import { burnOf } from '../shared/words'
import { CLI_CONFIG } from './paths'

/** The last reading that came back, kept beside the application's own data. */
function file(): string {
  return join(app.getPath('userData'), 'usage.json')
}

const run = promisify(execFile)

// The five hour window moves by more than a point a minute under a heavy session, so a number a
// quarter of an hour old is not the same number. It was, and the board said it without a word.
const TTL = 180
// Two refresh cycles missed: one is the normal gap, two means the number is standing still.
const STALE = TTL * 2
/**
 * The windows, and how long each one is: the endpoint says how full they are, never how wide. The
 * long label is said when a board is built, so it follows the language like everything else.
 */
const WINDOWS: [string, PhraseKey, string, number][] = [
  ['five_hour', 'windowFiveHour', '5 h', 300],
  ['seven_day', 'windowSevenDay', '7 d', 10080]
]

// The same question Claude Code asks itself, `at_wall=1` wanting the values at the wall of the
// window. `skip_spend=1` used to ride with it and no longer does: it is what leaves `extra_usage`
// out of the answer, and that is the only place the credits are counted.
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage?at_wall=1'
const KEYCHAIN = 'Claude Code-credentials'
/** A token that expires on the way answers 401, and the window would stand still on a stale number. */
const SPARE = 60_000

interface StoredWindow {
  used_percentage?: number
  resets_at?: number
  duration_minutes?: number
}

interface Stored {
  captured_at?: number
  /** Whose numbers these are: a reading kept across a re-login belongs to the account before it. */
  account?: string
  /** Why this reading could not be taken; only ever set on one we did not manage to take. */
  error?: string
  /** Absent rather than zero when the account has never spent a credit. */
  spend?: Spend
  [key: string]: StoredWindow | Spend | string | number | undefined
}

async function stored(): Promise<Stored> {
  try {
    return JSON.parse(await readFile(file(), 'utf8')) as Stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`${file()}: ${(error as Error).name}`)
    return {}
  }
}

/**
 * The reading kept for the next start, so a board opened while the token is expired says a number
 * with its age on it rather than nothing at all.
 *
 * It fails quietly: a window that cannot be written is still a window that can be drawn.
 */
async function remember(data: Stored): Promise<void> {
  try {
    await writeFile(file(), JSON.stringify(data), { mode: 0o600 })
  } catch (error) {
    console.warn(`${file()}: ${(error as Error).name}`)
  }
}

/**
 * The access token Claude Code keeps in the Keychain, or why there is none to use.
 *
 * Read, never renewed. Renewing it rotates the refresh token, which kills the login of whoever
 * used the old one, and Claude Code renews its own within seconds of expiry anyway. A board that
 * joined that race would log the CLI out to draw a percentage.
 */
async function token(): Promise<{ value: string } | { error: string }> {
  let raw: string
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', KEYCHAIN, '-w'], {
      timeout: 10_000
    })
    raw = stdout
  } catch {
    return { error: say('noKeychainLogin') }
  }
  let oauth: { accessToken?: string; expiresAt?: number } = {}
  try {
    oauth = (JSON.parse(raw) as { claudeAiOauth?: typeof oauth }).claudeAiOauth ?? {}
  } catch {
    return { error: say('keychainUnreadable') }
  }
  if (!oauth.accessToken) return { error: say('noKeychainLogin') }
  if (!oauth.expiresAt || oauth.expiresAt < Date.now() + SPARE)
    return { error: say('tokenExpired') }
  return { value: oauth.accessToken }
}

/** One window as the answer has it, or null when what came back is not a window at all. */
function gauge(value: unknown): { utilization: number; resets_at?: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const { utilization, resets_at: resets } = value as { utilization?: number; resets_at?: string }
  if (typeof utilization !== 'number') return null
  return { utilization, resets_at: resets }
}

/**
 * The credits out of `extra_usage`, or nothing at all.
 *
 * Nothing is the answer to every doubt here, because a badge that says the wrong amount is worse
 * than no badge: without `decimal_places` the same figure reads as either 374.95 or 37,495, and
 * which of the two it is cannot be guessed from the number.
 */
function spendOf(value: unknown): Spend | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const extra = value as {
    is_enabled?: boolean
    used_credits?: number
    currency?: string
    decimal_places?: number
  }
  if (extra.is_enabled !== true) return undefined
  if (typeof extra.used_credits !== 'number' || extra.used_credits <= 0) return undefined
  if (typeof extra.currency !== 'string' || typeof extra.decimal_places !== 'number')
    return undefined
  return { used: extra.used_credits, currency: extra.currency, decimals: extra.decimal_places }
}

/** `resets_at` comes as ISO 8601 here, and everything below this line counts in epoch seconds. */
function epochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed / 1000
}

/**
 * The windows as the endpoint has them now, or why it could not be asked.
 *
 * `utilization` is already a percentage here, not a fraction: multiplying it would leave a window
 * spent to 300 %.
 */
async function live(now: number): Promise<Stored> {
  const key = await token()
  if ('error' in key) return { error: key.error }
  let payload: Record<string, unknown>
  try {
    const response = await fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${key.value}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-sessions/1'
      },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) throw new Error(say('usageStatus', response.status))
    payload = (await response.json()) as typeof payload
  } catch (error) {
    return { error: (error as Error).message.split('\n')[0].slice(0, 200) }
  }
  const data: Stored = { captured_at: now }
  let found = false
  for (const [name, , , minutes] of WINDOWS) {
    const window = gauge(payload[name])
    if (!window) continue
    data[name] = {
      used_percentage: window.utilization,
      resets_at: epochSeconds(window.resets_at),
      duration_minutes: minutes
    }
    found = true
  }
  // The credits ride with the windows but do not make a reading: an answer carrying nothing else is
  // still an answer the board cannot draw.
  const spent = spendOf(payload.extra_usage)
  if (spent) data.spend = spent
  // An empty answer is not a reading, and saying so beats drawing a board with no windows on it.
  return found ? data : { error: say('usageEmpty') }
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

/** The last answer and when it came, so a fifteen second sweep is not fifteen seconds of asking. */
let reading: { at: number; data: Stored } | null = null

export async function usage(now: number): Promise<{ windows: UsageWindow[]; spend: Spend | null }> {
  if (!reading || now - reading.at > TTL) {
    const taken = await live(now)
    if (taken.error === undefined)
      await remember({ ...taken, account: (await cliAccount()) ?? undefined })
    reading = { at: now, data: taken }
  }
  let data = reading.data
  const failed = typeof data.error === 'string' ? data.error : null
  // The reading kept from before is older than one of our own, but it is a number that was really
  // read once, and it carries the moment it was read at.
  if (failed !== null) data = { ...(await stored()), error: failed }
  // Only the kept one needs this: a reading taken now used the Keychain token of the account the
  // CLI is logged into, so asking whose numbers these are would be asking about the login twice.
  const stamped = typeof data.account === 'string' ? data.account : null
  const current = stamped ? await cliAccount() : null
  const otherAccount = stamped && current && stamped !== current ? stamped : null
  const windows: UsageWindow[] = []
  for (const [key, phrase, short] of WINDOWS) {
    const window = data[key]
    if (typeof window !== 'object' || !window || !('used_percentage' in window)) continue
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
  // Off the same reading as the windows, the kept one included: a figure that was true when it was
  // last read is what the windows say too, and the bar already says once that the reading is old.
  const kept = data.spend
  const spend = typeof kept === 'object' && kept !== null && 'used' in kept ? kept : null
  return { windows, spend }
}
