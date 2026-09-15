import { decimal, say, stateWord } from './i18n'
import type { Change, StateWord, UsageWindow } from './types'

export function ago(moment: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - moment))
  if (seconds < 60) return say('justNow')
  if (seconds < 3600) return say('agoMinutes', Math.floor(seconds / 60))
  if (seconds < 86400) return say('agoHours', Math.floor(seconds / 3600))
  return say('agoDays', Math.floor(seconds / 86400))
}

export function inWords(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  // A run that started twenty seconds ago should not read as zero minutes.
  if (whole < 60) return `${whole} ${say('seconds')}`
  if (whole < 3600) return `${Math.floor(whole / 60)} ${say('minutes')}`
  if (whole < 86400) {
    return `${Math.floor(whole / 3600)} ${say('hours')} ${Math.floor((whole % 3600) / 60)} ${say('minutes')}`
  }
  return `${Math.floor(whole / 86400)} ${say('days')} ${Math.floor((whole % 86400) / 3600)} ${say('hours')}`
}

export function clock(moment: number, seconds = false): string {
  return new Date(moment * 1000).toLocaleTimeString(say('clock'), {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {})
  })
}

/** The day a moment fell on, with the year only where it is not this one. */
export function day(moment: number): string {
  const date = new Date(moment * 1000)
  return date.toLocaleDateString(say('clock'), {
    day: 'numeric',
    month: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' })
  })
}

/**
 * A token count short enough to read at a glance. A session reads millions back off the cache and
 * sends a few dozen fresh, so the unit moves with the number rather than one unit fitting both.
 */
export function tokenCount(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${decimal(count / 1000, count < 10_000 ? 1 : 0)} k`
  return `${decimal(count / 1_000_000, count < 10_000_000 ? 2 : 1)} M`
}

/**
 * The state word with what a running set of checks adds to it: how many are done and how long it
 * has been going. A job that failed early keeps the count, because the rest of the run is still out.
 */
export function stateLabel(state: StateWord, change: Change | null): string {
  const label = stateWord(state)
  const progress = change?.progress
  if (!progress || progress.total === 0) return label
  const running = progress.done < progress.total
  if (state === 'ci-running' || (state === 'ci-red' && running)) {
    const elapsed = progress.since ? ` · ${inWords(Date.now() / 1000 - progress.since)}` : ''
    return `${label} ${progress.done}/${progress.total}${elapsed}`
  }
  // A run that is over says when, because a red check from yesterday is not the same news as one
  // from two minutes ago.
  if ((state === 'ci-red' || state === 'in-review' || state === 'mergeable') && progress.until) {
    return `${label} · ${ago(progress.until)}`
  }
  return label
}

/**
 * How long the window lasts at the pace it has been going: what is left divided by what a second of
 * this window has been costing. Nothing spent yet means nothing to run out of.
 */
export function burnOf(used: number, left: number, minutes: number): number | null {
  const elapsed = minutes * 60 - left
  if (elapsed <= 0 || used <= 0) return null
  return ((100 - used) / used) * elapsed
}

/**
 * How long ago the board was read before the reading stops being one: the sweep is every 15
 * seconds, so a board older than three of them has missed a sweep and one older than six has
 * stopped being swept at all. Those are the two moments worth a colour.
 */
const SWEPT = 45
const UNSWEPT = 90

/**
 * Whether the board in front of her is still being read, as one of the three colours the cards use.
 *
 * A time printed on a window that has stopped refreshing looks exactly like a time printed on one
 * that is: both say a moment that was true once. Every other number here is a reading taken now, so
 * the one that says when the reading was taken has to say whether it is still being taken.
 */
export function refreshVerdict(at: number, now: number): 'ok' | 'warn' | 'danger' {
  const age = now - at
  if (age <= SWEPT) return 'ok'
  return age <= UNSWEPT ? 'warn' : 'danger'
}

/** Green while the window outlives the reset, amber just short of it, red when it runs out first. */
export function burnVerdict(burn: number | null, left: number): 'ok' | 'warn' | 'danger' {
  if (burn === null) return 'ok'
  if (burn >= left * 1.1) return 'ok'
  return burn >= left * 0.9 ? 'warn' : 'danger'
}

/**
 * Why a usage window may not be the current one, in the order it is worth hearing, or empty.
 *
 * A percentage nobody could refresh looks exactly like a percentage that has not moved, and every
 * number on this board is read as a reading taken now. The bar, the tray and the terminal all say
 * this the same way, so it is said once here.
 */
export function doubtsOf(window: UsageWindow): string[] {
  const parts: string[] = []
  if (window.stale !== null) parts.push(say('stale', inWords(window.stale)))
  if (window.error !== null) parts.push(say('notRefreshed', window.error))
  if (window.otherAccount !== null) parts.push(say('account', window.otherAccount))
  return parts
}

/**
 * One usage window as a line: the number, then what it means.
 *
 * A doubted window keeps the reset, which is a moment and stays true however old the reading is,
 * and loses the burn, which is arithmetic on the reading itself. Why it is doubted is not repeated
 * here: that belongs to the file both windows came from and is said once beside them.
 */
export function usageLine(window: UsageWindow): string {
  const head = `${window.short} ${Math.round(window.used)} %`
  const reset = say('resetsIn', inWords(window.left))
  if (doubtsOf(window).length > 0) return `${head} · ${reset}`
  const burn = window.burn === null ? say('burnsNothing') : say('burnsIn', inWords(window.burn))
  return `${head} · ${burn} · ${reset}`
}

/**
 * The usage rows of a menu: one per window, and under them one more saying why they are doubted.
 *
 * That last row carries no window, which is the point of it. The doubt belongs to the one file both
 * windows were read from, so printing it on each of them says the same account address twice.
 */
export function usageRows(windows: UsageWindow[]): { label: string; window: UsageWindow | null }[] {
  const rows: { label: string; window: UsageWindow | null }[] = windows.map((window) => ({
    label: usageLine(window),
    window
  }))
  const doubt = windows.map(doubtsOf).find((parts) => parts.length > 0)
  if (doubt) rows.push({ label: doubt.join(' · '), window: null })
  return rows
}

/**
 * Hues deliberately beside the state palette rather than among it, so a stripe is never read as a
 * state. Six of them, because past that they stop being told apart at three pixels wide.
 */
const REPO_COLOURS = ['#e0669c', '#3fbf9f', '#f0a500', '#7d7bf5', '#9ccc3f', '#5fc7e8']

/** The same repository keeps the same colour on every machine and every restart, which is the point. */
export function repoColour(repo: string): string {
  let hash = 2166136261
  for (let at = 0; at < repo.length; at++) {
    hash ^= repo.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return REPO_COLOURS[Math.abs(hash) % REPO_COLOURS.length] as string
}
