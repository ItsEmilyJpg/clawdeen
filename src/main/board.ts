import { readFile } from 'node:fs/promises'

import { everyStateWord, locale, say } from '../shared/i18n'
import { ordered } from '../shared/projects'
import { settings } from './settings'
import type { ActivityWord, Board, Change, Link, Session, StateWord } from '../shared/types'
import { JIRA_MAP } from './paths'
import { gateState, gates, type GateConfig } from './gate'
import { branchAt, githubPrs, gitlabMr, isPullRequest, remote, viewPr, workingCopy } from './forge'
import { branches, openSession, records, type SessionRecord } from './records'
import { record, standing, today } from './history'
import { liveAt, liveState } from './live'
import { order } from './order'
import {
  lastTurn,
  modified,
  pendingWork,
  touchedPaths,
  transcripts,
  watchedFor,
  type Doing
} from './transcripts'
import { usage } from './usage'

const ACTIVE_SECONDS = 180
const WAITING_SECONDS = 1800
/** How far back a session is still asked whether a task of its own is running. */
const PENDING_SECONDS = 6 * 3600
/** How long a hook that said a session was working keeps saying so. */
const HEARD_FRESH = 120

/** What a task of the session's own is doing, in the words a row says. */
const DOING: { [key in Doing]: ActivityWord } = {
  working: 'task-running',
  waiting: 'task-queued',
  watching: 'waiting-for-you',
  queued: 'gate-queued',
  gating: 'gate-running'
}

const ISSUE_IN_BRANCH = /(?:^|\/)(?:task-)?(\d{1,6})(?:-|$)/
const ISSUE_IN_TITLE = /(?<!PR )(?<!MR )#(\d{1,6})\b/

/** Wider than the word list a session name carries, because a row can say what a title should not. */
function displayState(change: Change | null): StateWord {
  if (!change) return 'no-pr'
  if (!change.open) return change.state ?? 'closed'
  if (change.conflict) return 'conflict'
  if (change.checks) return change.checks
  if (change.draft) return 'draft'
  if (change.review === 'CHANGES_REQUESTED') return 'changes-requested'
  return change.review === 'APPROVED' ? 'mergeable' : 'in-review'
}

/** The title repeats the issue, the change and the state, which the row already carries as labels. */
function headline(title: string, links: (Link | null)[], state: StateWord): string {
  const spent = new Set(
    links
      .filter(Boolean)
      .map((link) => link!.token.toLowerCase())
      // Whoever named the session wrote one of these where it found no issue, in its own language.
      .concat('bez issue', 'no issue')
  )
  const words = new Set(
    everyStateWord()
      .map((word) => word.toLowerCase())
      .concat(state.toLowerCase())
  )
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
export interface Doing2 {
  word: ActivityWord | null
  since: number | null
  /** What is running beside it, where the session is doing something of its own as well. */
  extra: ActivityWord | null
  /**
   * True where `čeká na tebe` is only the fallback: the turn is over and nothing of its own is
   * running, which is a guess at her being next, not the session asking for anything.
   */
  idle?: boolean
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
  if (asking) return { word: 'waiting-for-you', since: null, extra: beside }
  if (working) return { word: 'working', since, extra: beside }
  if (beside) return { word: beside, since, extra: null }
  // A monitor is a wait on something with a name, and the row says which: a run, an issue, or
  // whatever else it was pointed at. None of them rings, because none of them is hers to answer.
  if (doing?.doing === 'watching') {
    const seen = path ? await watchedFor(path) : null
    const word: ActivityWord =
      seen?.kind === 'ci'
        ? 'waiting-for-ci'
        : seen?.kind === 'issue'
          ? 'waiting-for-issue'
          : 'waiting-for-other'
    return { word, since: null, extra: null }
  }
  if (age > WAITING_SECONDS || turn === 'running' || turn === 'blocked') return nothing
  return { word: 'waiting-for-you', since: null, extra: null, idle: true }
}

/**
 * What the silence after a finished turn is about. A session that stopped with a run going on its
 * own change is waiting on that run, not on her, and the fallback above cannot see it: the checks
 * are read off the change, which is only known once the working copy is. A session that asked
 * something keeps ringing, because that question is hers whatever the run does.
 */
export function waitingOn(doing: Doing2, change: Change | null): ActivityWord | null {
  if (!doing.idle || change?.checks !== 'ci-running') return doing.word
  return 'waiting-for-ci'
}

/**
 * Where the session works, which is not where it was opened as soon as the work happens in another
 * checkout: the newest directory its own commands name, where that is a working copy at all.
 */
async function workedIn(path: string | undefined, opened: string): Promise<string> {
  if (!path) return opened
  for (const said of await touchedPaths(path, opened)) {
    const copy = await workingCopy(said)
    if (copy) return copy
  }
  return opened
}

async function describe(
  opened: SessionRecord,
  now: number,
  index: Map<string, string>,
  config: GateConfig | null,
  trackers: { [key: string]: string },
  open: string | null
): Promise<Session> {
  const path = index.get(opened.cliSessionId ?? '')
  const doing = await activity(opened, now, index, config)
  const from = opened.originCwd ?? opened.cwd ?? ''
  const root = await workedIn(path, from)
  // A session working outside the copy it was opened in carries none of that copy's branches: they
  // name work in another repository, and asking this one about them answers about somebody else.
  const record: SessionRecord =
    root === from
      ? opened
      : {
          ...opened,
          branch: (await branchAt(root)) ?? undefined,
          writtenBranches: [],
          worktreeName: undefined
        }
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
  // The repository, from the forge path where there is one and from the working copy where there is
  // not. The same name labels the card and answers the project filter, so it is worked out once.
  const named = (project ?? root).replace(/\/$/, '').split('/').at(-1) ?? ''
  const title = (record.title ?? say('untitled')).split(/\s+/).join(' ')
  const state = displayState(change)
  const word = waitingOn(doing, change)
  return {
    id: record.sessionId,
    cli: record.cliSessionId ?? '',
    title,
    headline: headline(title, [issue, change], state),
    place: [named, record.worktreeName ?? record.branch].filter(Boolean).join(' · '),
    project: named,
    last,
    active: now - last < ACTIVE_SECONDS,
    issue,
    change,
    changes,
    state,
    activity: word,
    extra: doing.extra,
    heard: liveState(record.cliSessionId ?? '', now),
    // A wait the board worked out from the change has no monitor behind it, so nothing names it:
    // the run it is about is already on the row as the state.
    about:
      word === doing.word && word?.startsWith('waiting-for') && path
        ? ((await watchedFor(path))?.about ?? null)
        : null,
    since: doing.since,
    // Filled in by board() from the stretch history, which describing one session cannot see.
    entered: null,
    pinned: Boolean(record.isStarred),
    focused: record.sessionId === open
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
  const open = openSession(found)
  const sessions = await Promise.all(
    found.map((record) => describe(record, now, index, config, trackers, open))
  )
  // How long a card has stood where it stands, off the stretch the last pass left open, so a lane
  // can hold its order while the sessions in it work. A word that has only just changed has no
  // stretch under it yet, and a session doing nothing never gets one.
  const began = standing()
  for (const session of sessions) {
    const held = began.get(session.id)
    session.entered = session.activity
      ? held?.word === session.activity
        ? held.began
        : Math.round(now)
      : null
  }
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
      Number(one.activity !== 'waiting-for-you') - Number(other.activity !== 'waiting-for-you') ||
      placed(one) - placed(other) ||
      Number(!one.pinned) - Number(!other.pinned) ||
      Number(!one.active) - Number(!other.active) ||
      other.last - one.last
  )
  record(sessions, now)
  // Every repository the window holds, named once and sorted, so the settings can list them without
  // taking a label apart. The sessions themselves are handed over whole: hiding one is the window's
  // business, and the tray counts what the board knows rather than what it draws.
  const seen = [...new Set(sessions.map((session) => session.project).filter(Boolean))].sort()
  const projectOrder = settings().projectOrder
  const projects = ordered(seen, projectOrder)
  return {
    sessions,
    usage: await usage(now),
    order: kept,
    today: today(now),
    at: now,
    locale: locale(),
    projects,
    projectOrder,
    hidden: settings().hidden
  }
}
