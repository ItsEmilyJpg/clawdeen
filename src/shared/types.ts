export type StateWord =
  | 'pracuje'
  | 'gate běží'
  | 'gate ve frontě'
  | 'úloha běží'
  | 'úloha čeká'
  | 'čeká na tebe'
  | 'čeká na CI'
  | 'čeká na issue'
  | 'čeká na jiné'
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
  | 'pracuje'
  | 'gate běží'
  | 'gate ve frontě'
  | 'úloha běží'
  | 'úloha čeká'
  | 'čeká na tebe'
  | 'čeká na CI'
  | 'čeká na issue'
  | 'čeká na jiné'
>

/** How a card says which project it belongs to: a stripe in the repository's colour, or its name. */
export type ProjectMark = 'stripe' | 'name' | 'none'

/** Which palette the window draws in. `system` is no choice at all: it follows macOS. */
export type ThemeMode = 'system' | 'light' | 'dark'

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
  /** Every pull request beside the session, the one it stands on first. */
  changes: Change[]
  state: StateWord
  activity: ActivityWord | null
  /** A gate or a task running beside what the session itself is doing. */
  extra: ActivityWord | null
  /** What the session is waiting on, where it is known: the issue a monitor is watching. */
  about: string | null
  /** When the task it is waiting on started, so a row can say a long one has been on too long. */
  since: number | null
  /**
   * When the session entered the state it is in, read off the stretch history, so a lane can hold
   * its order while the cards in it keep working. Null where the session is doing nothing.
   */
  entered: number | null
  /** What the hooks last said about this session, or null where none of them has been heard from. */
  heard: string | null
  pinned: boolean
  /** The session open in the Claude app, which is not the same as her looking at it right now. */
  focused: boolean
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

/** A tool call as the pane shows it: what was called and the one argument that says what on. */
export interface Call {
  name: string
  about: string
}

/** One turn of a conversation as the board shows it back. */
export interface Line {
  role: 'user' | 'assistant'
  at: number
  text: string
  tools: Call[]
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
