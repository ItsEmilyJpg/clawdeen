import { readFile } from 'node:fs/promises'

import type { ActivityWord, Board, Change, Link, Session, StateWord } from '../shared/types'
import { JIRA_MAP } from './paths'
import { gateState, gates, type GateConfig } from './gate'
import { githubPrs, gitlabMr, isPullRequest, remote, viewPr } from './forge'
import { branches, records, type SessionRecord } from './records'
import { record, today } from './history'
import { liveAt, liveState } from './live'
import { order } from './order'
import { lastTurn, modified, pendingWork, transcripts, watchedFor, type Doing } from './transcripts'
import { usage } from './usage'

const ACTIVE_SECONDS = 180
const WAITING_SECONDS = 1800
/** How far back a session is still asked whether a task of its own is running. */
const PENDING_SECONDS = 6 * 3600
/** How long a hook that said a session was working keeps saying so. */
const HEARD_FRESH = 120

/** What a task of the session's own is doing, in the words a row says. */
const DOING: { [key in Doing]: ActivityWord } = {
  working: 'úloha běží',
  waiting: 'úloha čeká',
  watching: 'čeká na tebe',
  queued: 'gate ve frontě',
  gating: 'gate běží'
}

const ISSUE_IN_BRANCH = /(?:^|\/)(?:task-)?(\d{1,6})(?:-|$)/
const ISSUE_IN_TITLE = /(?<!PR )(?<!MR )#(\d{1,6})\b/

const STATE_WORDS: StateWord[] = [
  'pracuje',
  'gate běží',
  'gate ve frontě',
  'úloha běží',
  'úloha čeká',
  'čeká na tebe',
  'čeká na CI',
  'čeká na issue',
  'čeká na jiné',
  'bez PR',
  'koncept',
  'konflikt',
  'CI běží',
  'CI červené',
  'změny žádané',
  'k mergi',
  'k review',
  'merged',
  'zavřené'
]

/** Wider than the word list a session name carries, because a row can say what a title should not. */
function displayState(change: Change | null): StateWord {
  if (!change) return 'bez PR'
  if (!change.open) return change.state ?? 'zavřené'
  if (change.conflict) return 'konflikt'
  if (change.checks) return change.checks
  if (change.draft) return 'koncept'
  if (change.review === 'CHANGES_REQUESTED') return 'změny žádané'
  return change.review === 'APPROVED' ? 'k mergi' : 'k review'
}

/** The title repeats the issue, the change and the state, which the row already carries as labels. */
function headline(title: string, links: (Link | null)[], state: StateWord): string {
  const spent = new Set(
    links
      .filter(Boolean)
      .map((link) => link!.token.toLowerCase())
      .concat('bez issue')
  )
  const words = new Set(STATE_WORDS.map((word) => word.toLowerCase()).concat(state.toLowerCase()))
  const parts = title.split('·').map((part) => part.trim())
  if (words.has((parts.at(-1) ?? '').toLowerCase())) parts.pop()
  const kept = parts.filter((part) => !spent.has(part.toLowerCase()))
  return kept.join(' · ') || title
}

async function jiraTrackers(): Promise<{ [key: string]: string }> {
  try {
    const map = JSON.parse(await readFile(JIRA_MAP, 'utf8')) as { [key: string]: string }
    return Object.fromEntries(Object.entries(map).map(([key, url]) => [key.toUpperCase(), url]))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`${JIRA_MAP}: ${(error as Error).name}`)
    return {}
  }
}

function jiraIssue(
  texts: (string | null | undefined)[],
  trackers: { [key: string]: string }
): Link | null {
  const keys = Object.keys(trackers)
  if (keys.length === 0) return null
  const pattern = new RegExp(`\\b(${keys.join('|')})-(\\d+)\\b`, 'i')
  for (const text of texts) {
    const match = pattern.exec(text ?? '')
    if (match) {
      const key = `${match[1].toUpperCase()}-${match[2]}`
      return { label: `Jira ${key}`, token: key, url: trackers[match[1].toUpperCase()] + key }
    }
  }
  return null
}

/** A number a title carries is as often a pull request as an issue, and only GitHub knows which. */
function numbered(change: Change | null, record: SessionRecord): number | null {
  if (change) return null
  for (const text of [...branches(record), record.title]) {
    const match = ISSUE_IN_BRANCH.exec(text ?? '') ?? ISSUE_IN_TITLE.exec(text ?? '')
    if (match) return Number(match[1])
  }
  return null
}

function githubIssue(
  host: string,
  repo: string,
  change: Change | null,
  record: SessionRecord,
  taken: number | null
): Link | null {
  const link = (number: number | string): Link => ({
    label: `Issue #${number}`,
    token: `#${number}`,
    url: `https://${host}/${repo}/issues/${number}`
  })
  if (change && change.issues.length > 0) return link(change.issues[0])
  // A number that turned out to be the pull request is not also the issue.
  const spare = (found: RegExpExecArray | null): Link | null =>
    found && Number(found[1]) !== taken ? link(found[1]) : null
  for (const text of [change?.branch, ...branches(record)]) {
    const found = spare(ISSUE_IN_BRANCH.exec(text ?? ''))
    if (found) return found
  }
  return spare(ISSUE_IN_TITLE.exec(record.title ?? ''))
}

/** What a session is doing, and since when where something of its own is running. */
interface Doing2 {
  word: ActivityWord | null
  since: number | null
  /** What is running beside it, where the session is doing something of its own as well. */
  extra: ActivityWord | null
}

async function activity(
  record: SessionRecord,
  now: number,
  index: Map<string, string>,
  config: GateConfig | null
): Promise<Doing2> {
  const cli = record.cliSessionId ?? ''
  const path = index.get(cli)
  const nothing = { word: null, since: null, extra: null }
  if (!path) return nothing
  let age: number
  try {
    age = now - (await modified(path))
  } catch {
    return nothing
  }
  if (age > PENDING_SECONDS) return nothing

  // What the session left running: a gate of its own, a queued one, or a task in the background.
  const gate = await gateState(record, config)
  const doing = gate
    ? null
    : await pendingWork(
        cli,
        path,
        config ? { queueing: config.queueing, running: config.runningLine } : undefined
      )
  const beside = gate ?? (doing && doing.doing !== 'watching' ? DOING[doing.doing] : null)
  const since = gate ? null : (doing?.since ?? null)

  // What a hook said beats what the files say: the hooks are the fast path, the files answer when
  // nothing is listening. The app saying it needs her is the one thing no file says at all.
  const live = liveState(cli, now)
  const heard = liveAt(cli) ?? 0
  const turn = await lastTurn(path)
  const asking = (live === 'asking' && heard > now - WAITING_SECONDS) || turn === 'asking'
  // A session parked on a task's output is not working, it is waiting for that task to finish: the
  // tool it is sitting on is what says which of the two it is.
  const working =
    turn !== 'blocked' &&
    ((live === 'working' && heard > now - HEARD_FRESH) ||
      (turn === 'running' && age < WAITING_SECONDS))

  // Both can be true at once, and then what Claude is doing is the state while the gate rides
  // beside it: a session answering is working, even with a check queueing behind it.
  if (asking) return { word: 'čeká na tebe', since: null, extra: beside }
  if (working) return { word: 'pracuje', since, extra: beside }
  if (beside) return { word: beside, since, extra: null }
  // A monitor is a wait on something with a name, and the row says which: a run, an issue, or
  // whatever else it was pointed at. None of them rings, because none of them is hers to answer.
  if (doing?.doing === 'watching') {
    const seen = path ? await watchedFor(path) : null
    const word: ActivityWord =
      seen?.kind === 'ci' ? 'čeká na CI' : seen?.kind === 'issue' ? 'čeká na issue' : 'čeká na jiné'
    return { word, since: null, extra: null }
  }
  if (age > WAITING_SECONDS || turn === 'running' || turn === 'blocked') return nothing
  return { word: 'čeká na tebe', since: null, extra: null }
}

async function describe(
  record: SessionRecord,
  now: number,
  index: Map<string, string>,
  config: GateConfig | null,
  trackers: { [key: string]: string }
): Promise<Session> {
  const path = index.get(record.cliSessionId ?? '')
  const doing = await activity(record, now, index, config)
  const root = record.originCwd ?? record.cwd ?? ''
  const { host, project } = await remote(root)
  let change: Change | null = null
  let changes: Change[] = []
  let issue: Link | null = null
  if (host === 'github.com' && project) {
    changes = await githubPrs(project, record)
    change = changes.find((one) => one.open) ?? changes.at(-1) ?? null
    // A session that never pushed a branch still names its number in the title, and that number is
    // sometimes the pull request itself: a row saying `bez PR` over a red run is the worst of both.
    const named = numbered(change, record)
    const asPr = named !== null && (await isPullRequest(project, named))
    if (asPr && named !== null) {
      change = await viewPr(project, named)
      if (change) changes = [change]
    }
    issue = githubIssue(host, project, change, record, asPr ? named : null)
  } else if (host && project) {
    change = await gitlabMr(host, project, record)
    changes = change ? [change] : []
  }
  if (!issue) {
    issue = jiraIssue([change?.branch, ...branches(record), record.title], trackers)
  }
  const last = (record.lastActivityAt ?? 0) / 1000
  const title = (record.title ?? '(bez názvu)').split(/\s+/).join(' ')
  const state = displayState(change)
  return {
    id: record.sessionId,
    cli: record.cliSessionId ?? '',
    title,
    headline: headline(title, [issue, change], state),
    place: [
      (project ?? root).replace(/\/$/, '').split('/').at(-1),
      record.worktreeName ?? record.branch
    ]
      .filter(Boolean)
      .join(' · '),
    last,
    active: now - last < ACTIVE_SECONDS,
    issue,
    change,
    changes,
    state,
    activity: doing.word,
    extra: doing.extra,
    heard: liveState(record.cliSessionId ?? '', now),
    about:
      doing.word?.startsWith('čeká na') && path ? ((await watchedFor(path))?.about ?? null) : null,
    since: doing.since,
    pinned: Boolean(record.isStarred)
  }
}

export async function board(): Promise<Board> {
  const now = Date.now() / 1000
  const [index, config, trackers, found, kept] = await Promise.all([
    transcripts(),
    gates(),
    jiraTrackers(),
    records(now),
    order()
  ])
  const sessions = await Promise.all(
    found.map((record) => describe(record, now, index, config, trackers))
  )
  // Where she dragged a card wins over everything. Otherwise what she pinned in Claude comes first,
  // then what stands on her answer, and the rest stays in the order it last moved.
  const placed = (session: Session): number => {
    const at = kept.indexOf(session.id)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  // What waits on her answer stays on top even after she has dragged the rest into an order of her
  // own: a session she has to answer is the one thing that must not end up below the fold.
  sessions.sort(
    (one, other) =>
      Number(one.activity !== 'čeká na tebe') - Number(other.activity !== 'čeká na tebe') ||
      placed(one) - placed(other) ||
      Number(!one.pinned) - Number(!other.pinned) ||
      Number(!one.active) - Number(!other.active) ||
      other.last - one.last
  )
  record(sessions, now)
  return { sessions, usage: await usage(now), order: kept, today: today(now), at: now }
}
