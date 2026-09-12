import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Change, Job, StateWord } from '../shared/types'
import { branches, type SessionRecord } from './records'

const run = promisify(execFile)

const LOOKUP_TTL = 300
/** A check turns red while the session runs, so it is read back sooner than the rest. */
const CHECKS_TTL = 90
const PR_FIELDS =
  'url,state,isDraft,headRefName,closingIssuesReferences,statusCheckRollup,mergeable,reviewDecision'
const STATES: { [key: string]: StateWord } = {
  open: 'otevřené',
  opened: 'otevřené',
  merged: 'sloučené',
  closed: 'zavřené'
}
const OPEN_STATES = new Set(['open', 'opened'])
const CHECKS_RED = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])
const CHECKS_RUNNING = new Set([
  'QUEUED',
  'IN_PROGRESS',
  'PENDING',
  'WAITING',
  'REQUESTED',
  'EXPECTED'
])

interface Cached {
  at: number
  value: unknown
}

const memory = new Map<string, Cached>()

/** A failed lookup keeps the last good answer instead of blanking the board. */
async function cached<T>(
  key: string,
  ttl: number,
  compute: () => Promise<T | undefined>
): Promise<T | undefined> {
  const stored = memory.get(key)
  if (stored && Date.now() / 1000 - stored.at < ttl) return stored.value as T
  const value = await compute()
  if (value === undefined) return stored?.value as T | undefined
  memory.set(key, { at: Date.now() / 1000, value })
  return value
}

async function json<T>(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<T | undefined> {
  try {
    const { stdout } = await run(command, args, {
      timeout: 15_000,
      env: { ...process.env, ...env }
    })
    return JSON.parse(stdout) as T
  } catch (error) {
    console.warn(
      `${command} ${args.slice(0, 3).join(' ')}: ${(error as Error).message.split('\n')[0]}`
    )
    return undefined
  }
}

export async function remote(
  root: string
): Promise<{ host: string | null; project: string | null }> {
  try {
    const { stdout } = await run('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      timeout: 15_000
    })
    const match = /(?:@|:\/\/)([^/:@]+)[:/](.+?)(?:\.git)?$/.exec(stdout.trim())
    if (match) return { host: match[1], project: match[2] }
  } catch {
    // A directory that is gone, or one that is not a working copy at all: neither is worth a line.
  }
  return { host: null, project: null }
}

function stateOf(state: string | undefined, draft = false): StateWord | null {
  if (draft) return 'koncept'
  return STATES[(state ?? '').toLowerCase()] ?? null
}

interface RollupEntry {
  conclusion?: string
  state?: string
  status?: string
  name?: string
  context?: string
  detailsUrl?: string
  targetUrl?: string
}

/** A completed run carries its verdict in conclusion, a running one has none and only a status. */
export function checksOf(rollup: RollupEntry[] | undefined): {
  checks: Change['checks']
  failed: Job[]
} {
  const verdicts: string[] = []
  const failed: Job[] = []
  for (const entry of rollup ?? []) {
    const verdict = (entry.conclusion || entry.state || entry.status || '').toUpperCase()
    verdicts.push(verdict)
    if (CHECKS_RED.has(verdict)) {
      failed.push({
        label: entry.name || entry.context || 'check',
        url: entry.detailsUrl || entry.targetUrl || ''
      })
    }
  }
  if (failed.length > 0) return { checks: 'CI červené', failed }
  if (verdicts.some((verdict) => CHECKS_RUNNING.has(verdict)))
    return { checks: 'CI běží', failed: [] }
  return { checks: null, failed: [] }
}

interface PullRequest {
  url?: string
  state?: string
  isDraft?: boolean
  headRefName?: string
  closingIssuesReferences?: { number: number }[]
  statusCheckRollup?: RollupEntry[]
  mergeable?: string
  reviewDecision?: string
}

export async function githubPr(repo: string, record: SessionRecord): Promise<Change | null> {
  const recorded = (record.prs ?? []).filter((pr) => pr.prNumber)
  const chosen = recorded.find((pr) => pr.state === 'OPEN') ?? recorded.at(-1) ?? {}
  let number = chosen.prNumber
  if (number === undefined) {
    for (const branch of branches(record)) {
      const found = await cached<{ number: number }[]>(
        `gh-list:${repo}:${branch}`,
        LOOKUP_TTL,
        () =>
          json('gh', [
            'pr',
            'list',
            '-R',
            repo,
            '--head',
            branch,
            '--state',
            'all',
            '--limit',
            '1',
            '--json',
            'number'
          ])
      )
      if (found && found.length > 0) {
        number = found[0].number
        break
      }
    }
  }
  if (number === undefined) return null
  const view =
    (await cached<PullRequest>(`gh-view:${repo}:${number}:${PR_FIELDS}`, CHECKS_TTL, () =>
      json('gh', ['pr', 'view', String(number), '-R', repo, '--json', PR_FIELDS])
    )) ?? {}
  const state = view.state ?? chosen.state
  const url = view.url ?? chosen.url
  if (!url) return null
  const { checks, failed } = checksOf(view.statusCheckRollup)
  return {
    label: `PR #${number}`,
    token: `PR #${number}`,
    url,
    state: stateOf(state, view.isDraft),
    open: OPEN_STATES.has((state ?? '').toLowerCase()),
    draft: Boolean(view.isDraft),
    branch: view.headRefName ?? chosen.branch ?? null,
    checks,
    failed,
    conflict: view.mergeable === 'CONFLICTING',
    review: view.reviewDecision ?? null,
    issues: (view.closingIssuesReferences ?? []).map((reference) => reference.number)
  }
}

interface MergeRequest {
  iid: number
  web_url?: string
  state?: string
  draft?: boolean
  source_branch?: string
  has_conflicts?: boolean
}

export async function gitlabMr(
  host: string,
  project: string,
  record: SessionRecord
): Promise<Change | null> {
  for (const branch of branches(record)) {
    const found = await cached<MergeRequest[]>(
      `glab:${host}:${project}:${branch}`,
      LOOKUP_TTL,
      () =>
        json(
          'glab',
          ['mr', 'list', '-R', project, '--source-branch', branch, '--all', '-F', 'json'],
          {
            GITLAB_HOST: host
          }
        )
    )
    const mr = found?.[0]
    if (mr?.web_url) {
      return {
        label: `MR !${mr.iid}`,
        token: `MR !${mr.iid}`,
        url: mr.web_url,
        state: stateOf(mr.state, mr.draft),
        open: OPEN_STATES.has(mr.state ?? ''),
        draft: Boolean(mr.draft),
        branch: mr.source_branch ?? null,
        checks: null,
        failed: [],
        conflict: Boolean(mr.has_conflicts),
        review: null,
        issues: []
      }
    }
  }
  return null
}
