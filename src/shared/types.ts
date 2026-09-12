export type StateWord =
  | 'pracuje'
  | 'gate běží'
  | 'gate ve frontě'
  | 'úloha běží'
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
  | 'sloučené'
  | 'zavřené'

export type ActivityWord = Extract<
  StateWord,
  'pracuje' | 'gate běží' | 'gate ve frontě' | 'úloha běží' | 'čeká na tebe'
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

export interface Change extends Link {
  state: StateWord | null
  open: boolean
  draft: boolean
  branch: string | null
  checks: 'CI běží' | 'CI červené' | null
  failed: Job[]
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
}

export interface UsageWindow {
  key: string
  label: string
  short: string
  used: number
  resets: number
  left: number
  pace: number | null
  stale: number | null
}

export interface Board {
  sessions: Session[]
  usage: UsageWindow[]
  at: number
}
