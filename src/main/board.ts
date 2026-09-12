import { readFile } from 'node:fs/promises'

import type { ActivityWord, Board, Change, Link, Session, StateWord } from '../shared/types'
import { JIRA_MAP } from './paths'
import { gateState, gates, type GateConfig } from './gate'
import { githubPr, gitlabMr, remote } from './forge'
import { branches, records, type SessionRecord } from './records'
import { record, today } from './history'
import { order } from './order'
import { lastTurn, modified, pendingWork, transcripts } from './transcripts'
import { usage } from './usage'

const ACTIVE_SECONDS = 180
const WAITING_SECONDS = 1800
/** How far back a session is still asked whether a task of its own is running. */
const PENDING_SECONDS = 6 * 3600

const ISSUE_IN_BRANCH = /(?:^|\/)(?:task-)?(\d{1,6})(?:-|$)/
const ISSUE_IN_TITLE = /(?<!PR )(?<!MR )#(\d{1,6})\b/

const STATE_WORDS: StateWord[] = [
  'pracuje',
  'gate běží',
  'gate ve frontě',
  'úloha běží',
  'úloha čeká',
  'čeká na tebe',
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

function githubIssue(
  host: string,
  repo: string,
  change: Change | null,
  record: SessionRecord
): Link | null {
  const link = (number: number | string): Link => ({
    label: `Issue #${number}`,
    token: `#${number}`,
    url: `https://${host}/${repo}/issues/${number}`
  })
  if (change && change.issues.length > 0) return link(change.issues[0])
  for (const text of [change?.branch, ...branches(record)]) {
    const match = ISSUE_IN_BRANCH.exec(text ?? '')
    if (match) return link(match[1])
  }
  const match = ISSUE_IN_TITLE.exec(record.title ?? '')
  return match ? link(match[1]) : null
}

async function activity(
  record: SessionRecord,
  now: number,
  index: Map<string, string>,
  config: GateConfig | null
): Promise<ActivityWord | null> {
  const standing = await gateState(record, config)
  if (standing) return standing
  const cli = record.cliSessionId ?? ''
  const path = index.get(cli)
  if (!path) return null
  let age: number
  try {
    age = now - (await modified(path))
  } catch {
    return null
  }
  if (age > PENDING_SECONDS) return null
  const turn = await lastTurn(path)
  // An unanswered question is hers to close, whatever else the session has running.
  if (turn === 'asking') return 'čeká na tebe'
  const doing = await pendingWork(cli, path)
  if (doing) return doing === 'working' ? 'úloha běží' : 'úloha čeká'
  if (age > WAITING_SECONDS) return null
  if (turn === 'running') return age < ACTIVE_SECONDS ? 'pracuje' : null
  return 'čeká na tebe'
}

async function describe(
  record: SessionRecord,
  now: number,
  index: Map<string, string>,
  config: GateConfig | null,
  trackers: { [key: string]: string }
): Promise<Session> {
  const root = record.originCwd ?? record.cwd ?? ''
  const { host, project } = await remote(root)
  let change: Change | null = null
  let issue: Link | null = null
  if (host === 'github.com' && project) {
    change = await githubPr(project, record)
    issue = githubIssue(host, project, change, record)
  } else if (host && project) {
    change = await gitlabMr(host, project, record)
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
    state,
    activity: await activity(record, now, index, config),
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
