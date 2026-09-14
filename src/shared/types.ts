/**
 * The closed list of states. These are keys, not words on screen: what a card says is looked up per
 * language in `i18n.ts`, so a state can be renamed in one language without moving what the history
 * and the tray agree on. Adding one means adding it to the labels, the classes, the lanes and the
 * tray colours, exactly as before.
 */
export type StateWord =
  | 'working'
  | 'gate-running'
  | 'gate-queued'
  | 'task-running'
  | 'task-queued'
  | 'waiting-for-you'
  | 'waiting-for-ci'
  | 'waiting-for-issue'
  | 'waiting-for-other'
  | 'no-pr'
  | 'draft'
  | 'conflict'
  | 'ci-running'
  | 'ci-red'
  | 'changes-requested'
  | 'mergeable'
  | 'in-review'
  | 'open'
  | 'merged'
  | 'closed'

export type ActivityWord = Extract<
  StateWord,
  | 'working'
  | 'gate-running'
  | 'gate-queued'
  | 'task-running'
  | 'task-queued'
  | 'waiting-for-you'
  | 'waiting-for-ci'
  | 'waiting-for-issue'
  | 'waiting-for-other'
>

/** How a card says which project it belongs to: a stripe in the repository's colour, or its name. */
export type ProjectMark = 'stripe' | 'name' | 'none'

/** Which palette the window draws in. `system` is no choice at all: it follows macOS. */
export type ThemeMode = 'system' | 'light' | 'dark'

/** The languages the board speaks. It lives here so `i18n.ts` and the types do not import in a ring. */
export type Locale = 'en' | 'cs'

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
  checks: 'ci-running' | 'ci-red' | null
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
  /** The repository the session works in, which is what a project filter hides or shows. */
  project: string
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
  /** How old the numbers are, once that is old enough to matter; null while they are fresh. */
  stale: number | null
  /** Why the last refresh failed, so a standing number never reads as a current one. */
  error: string | null
  /** Whose the numbers are, once that is no longer the account the CLI is logged into. */
  otherAccount: string | null
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
  /** The language the window draws in. The renderer reads no settings of its own. */
  locale: Locale
  /**
   * Every repository seen in the window, so the settings can offer them without parsing labels.
   * Already in the order she arranged them in, with the ones she never moved behind it.
   */
  projects: string[]
  /**
   * The repositories she dragged into an order of her own, which is also what the cards inside a
   * lane sort by. Empty until she drags one, and a lane then sorts exactly as it did before.
   */
  projectOrder: string[]
  /**
   * The repositories the window does not draw. Kept as what is hidden rather than what is shown, so
   * a repository opened for the first time appears on its own instead of waiting to be allowed.
   */
  hidden: string[]
}
