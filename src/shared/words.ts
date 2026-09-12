import type { Change, StateWord, UsageWindow } from './types'

export function ago(moment: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - moment))
  if (seconds < 60) return 'právě teď'
  if (seconds < 3600) return `před ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `před ${Math.floor(seconds / 3600)} h`
  return `před ${Math.floor(seconds / 86400)} d`
}

export function inWords(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  // A run that started twenty seconds ago should not read as zero minutes.
  if (whole < 60) return `${whole} s`
  if (whole < 3600) return `${Math.floor(whole / 60)} min`
  if (whole < 86400) return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`
  return `${Math.floor(whole / 86400)} d ${Math.floor((whole % 86400) / 3600)} h`
}

export function clock(moment: number, seconds = false): string {
  return new Date(moment * 1000).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {})
  })
}

/**
 * The state word with what a running set of checks adds to it: how many are done and how long it
 * has been going. A job that failed early keeps the count, because the rest of the run is still out.
 */
export function stateLabel(state: StateWord, change: Change | null): string {
  const progress = change?.progress
  if (!progress || progress.total === 0) return state
  const running = progress.done < progress.total
  if (state === 'CI běží' || (state === 'CI červené' && running)) {
    const elapsed = progress.since ? ` · ${inWords(Date.now() / 1000 - progress.since)}` : ''
    return `${state} ${progress.done}/${progress.total}${elapsed}`
  }
  // A run that is over says when, because a red check from yesterday is not the same news as one
  // from two minutes ago.
  if ((state === 'CI červené' || state === 'k review' || state === 'k mergi') && progress.until) {
    return `${state} · ${ago(progress.until)}`
  }
  return state
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
  if (window.stale !== null) parts.push(`stav před ${inWords(window.stale)}`)
  if (window.error !== null) parts.push(`neobnoveno: ${window.error}`)
  if (window.otherAccount !== null) parts.push(`účet ${window.otherAccount}`)
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
  const reset = `reset za ${inWords(window.left)}`
  if (doubtsOf(window).length > 0) return `${head} · ${reset}`
  const burn = window.burn === null ? 'nespálíš nic' : `spálíš za ${inWords(window.burn)}`
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
