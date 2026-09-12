export type StateWord =
  | 'pracuje'
  | 'gate běží'
  | 'gate ve frontě'
  | 'úloha běží'
  | 'úloha čeká'
  | 'čeká na tebe'
  | 'bez PR'
  | 'koncept'
  | 'konflikt'
  | 'CI běží'
  | 'CI červené'
  | 'změny žádané'
  | 'k mergi'
  | 'k review'
  | 'otevřené'
  | 'merged'
  | 'zavřené'

export type ActivityWord = Extract<
  StateWord,
  'pracuje' | 'gate běží' | 'gate ve frontě' | 'úloha běží' | 'úloha čeká' | 'čeká na tebe'
>

export interface Link {
  label: string
  token: string
  url: string
}

export interface Job {
  label: string
  url: string
}

/** How far a run has got: what a row says while the checks are still going. */
export interface Progress {
  done: number
  total: number
  failed: number
  /** When the earliest check started, so a row can say how long it has been running. */
  since: number | null
  /** When the last one finished, so a run that is over can say how long ago that was. */
  until: number | null
}

export interface Change extends Link {
  state: StateWord | null
  open: boolean
  draft: boolean
  branch: string | null
  checks: 'CI běží' | 'CI červené' | null
  failed: Job[]
  progress: Progress
  conflict: boolean
  review: string | null
  issues: number[]
}

export interface Session {
  id: string
  cli: string
  title: string
  headline: string
  place: string
  last: number
  active: boolean
  issue: Link | null
  change: Change | null
  state: StateWord
  activity: ActivityWord | null
  /** What the session is waiting on, where it is known: the issue a monitor is watching. */
  about: string | null
  /** When the task it is waiting on started, so a row can say a long one has been on too long. */
  since: number | null
  pinned: boolean
}

export interface UsageWindow {
  key: string
  label: string
  short: string
  used: number
  resets: number
  left: number
  pace: number | null
  /** Seconds until the window is spent at the pace so far, or null while nothing has been spent. */
  burn: number | null
  stale: number | null
}

/** One turn of a conversation as the board shows it back. */
export interface Line {
  role: 'user' | 'assistant'
  at: number
  text: string
  tools: string[]
}

/** How long the day spent in one state, across every session. */
export interface Spell {
  word: ActivityWord
  seconds: number
}

export interface Board {
  sessions: Session[]
  usage: UsageWindow[]
  /** Session ids in the order she dragged them into; empty until she does. */
  order: string[]
  today: Spell[]
  at: number
}
