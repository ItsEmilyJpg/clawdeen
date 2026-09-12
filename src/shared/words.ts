import type { Change, StateWord } from './types'

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

export function clock(moment: number): string {
  return new Date(moment * 1000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
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
