import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Change, Job, Progress, StateWord } from '../shared/types'
import { branches, type SessionRecord } from './records'

const run = promisify(execFile)

const LOOKUP_TTL = 300
/** A check turns red while the session runs, so it is read back sooner than the rest. */
const CHECKS_TTL = 90
/** The kind of a number that exists never changes. */
const KIND_TTL = 30 * 86400
/**
 * A number that is not there yet is one the repository will reach, and a repository the token lost
 * access to answers the same 404, so "no such number" is believed for an hour rather than a month.
 */
const MISSING_TTL = 3600
const PR_FIELDS =
  'url,state,isDraft,headRefName,closingIssuesReferences,statusCheckRollup,mergeable,reviewDecision'
const STATES: { [key: string]: StateWord } = {
  open: 'open',
  opened: 'open',
  merged: 'merged',
  closed: 'closed'
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
  ttl: number
  value: unknown
}

const memory = new Map<string, Cached>()

/** A failed lookup keeps the last good answer instead of blanking the board. */
async function cached<T>(
  key: string,
  ttl: number | ((value: T) => number),
  compute: () => Promise<T | undefined>
): Promise<T | undefined> {
  const stored = memory.get(key)
  if (stored && Date.now() / 1000 - stored.at < stored.ttl) return stored.value as T
  const value = await compute()
  if (value === undefined) return stored?.value as T | undefined
  memory.set(key, {
    at: Date.now() / 1000,
    ttl: typeof ttl === 'function' ? ttl(value) : ttl,
    value
  })
  return value
}

/**
 * Whether gh failed because GitHub answered that the thing is not there. That is an answer about the
 * thing; a missing gh, a timeout, a rate limit or a bad token says nothing about it.
 */
export function notFound(error: unknown): boolean {
  const { stderr } = (error ?? {}) as { stderr?: unknown }
  return typeof stderr === 'string' && /\(HTTP 404\)/.test(stderr)
}

async function json<T>(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; missing?: T } = {}
): Promise<T | undefined> {
  try {
    const { stdout } = await run(command, args, {
      timeout: 15_000,
      env: { ...process.env, ...options.env }
    })
    return JSON.parse(stdout) as T
  } catch (error) {
    if ('missing' in options && notFound(error)) return options.missing
    console.warn(
      `${command} ${args.slice(0, 3).join(' ')}: ${(error as Error).message.split('\n')[0]}`
    )
    return undefined
  }
}

const remotes = new Map<string, { host: string | null; project: string | null }>()

/** A working copy does not change its origin while the application runs, so it is asked once. */
export async function remote(
  root: string
): Promise<{ host: string | null; project: string | null }> {
  const known = remotes.get(root)
  if (known) return known
  try {
    const { stdout } = await run('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      timeout: 15_000
    })
    const match = /(?:@|:\/\/)([^/:@]+)[:/](.+?)(?:\.git)?$/.exec(stdout.trim())
    if (match) {
      const found = { host: match[1], project: match[2] }
      remotes.set(root, found)
      return found
    }
  } catch {
    // A directory that is gone, or one that is not a working copy at all: neither is worth a line.
  }
  return { host: null, project: null }
}

const copies = new Map<string, string | null>()

/** Whether a directory a session named is a working copy, and which one: a worktree answers itself. */
export async function workingCopy(path: string): Promise<string | null> {
  const known = copies.get(path)
  if (known !== undefined) return known
  let top: string | null = null
  try {
    const { stdout } = await run('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      timeout: 15_000
    })
    top = stdout.trim() || null
  } catch {
    // A directory that is gone, or one that is not a working copy: neither is worth asking twice.
  }
  copies.set(path, top)
  return top
}

/** What is checked out where the session works, which is what its pull request is named after. */
export async function branchAt(root: string): Promise<string | null> {
  const found = await cached<string>(`branch:${root}`, LOOKUP_TTL, async () => {
    try {
      const { stdout } = await run('git', ['-C', root, 'branch', '--show-current'], {
        timeout: 15_000
      })
      return stdout.trim()
    } catch {
      return undefined
    }
  })
  return found || null
}

function stateOf(state: string | undefined, draft = false): StateWord | null {
  if (draft) return 'draft'
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
  startedAt?: string
  completedAt?: string
}

/** A completed run carries its verdict in conclusion, a running one has none and only a status. */
export function checksOf(rollup: RollupEntry[] | undefined): {
  checks: Change['checks']
  failed: Job[]
  progress: Progress
} {
  const verdicts: string[] = []
  const failed: Job[] = []
  const started: number[] = []
  const finished: number[] = []
  let done = 0
  for (const entry of rollup ?? []) {
    const verdict = (entry.conclusion || entry.state || entry.status || '').toUpperCase()
    verdicts.push(verdict)
    if (entry.startedAt) started.push(Date.parse(entry.startedAt) / 1000)
    if (entry.completedAt) finished.push(Date.parse(entry.completedAt) / 1000)
    if (!CHECKS_RUNNING.has(verdict)) done += 1
    if (CHECKS_RED.has(verdict)) {
      failed.push({
        label: entry.name || entry.context || 'check',
        url: entry.detailsUrl || entry.targetUrl || ''
      })
    }
  }
  const progress: Progress = {
    done,
    total: verdicts.length,
    failed: failed.length,
    since: started.length > 0 ? Math.min(...started) : null,
    until: finished.length > 0 && finished.length === verdicts.length ? Math.max(...finished) : null
  }
  // A job that failed early is worth saying even while the rest of the run is still going.
  if (failed.length > 0) return { checks: 'ci-red', failed, progress }
  if (verdicts.some((verdict) => CHECKS_RUNNING.has(verdict))) {
    return { checks: 'ci-running', failed: [], progress }
  }
  return { checks: null, failed: [], progress }
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

/** Whether a number is an issue or a pull request, which GitHub only tells by asking. */
export async function isPullRequest(repo: string, number: number): Promise<boolean> {
  // A 404 is kept as null, so a number that is not in the repository is not asked again every sweep.
  const found = await cached<boolean | null>(
    `kind:${repo}:${number}`,
    (kind) => (kind === null ? MISSING_TTL : KIND_TTL),
    () =>
      json<boolean | null>(
        'gh',
        ['api', `repos/${repo}/issues/${number}`, '--jq', '.pull_request != null'],
        { missing: null }
      )
  )
  return found === true
}

/** One pull request, read the way the board needs it. */
export async function viewPr(
  repo: string,
  number: number,
  chosen: { url?: string; state?: string; branch?: string } = {}
): Promise<Change | null> {
  const view =
    (await cached<PullRequest>(`gh-view:${repo}:${number}:${PR_FIELDS}`, CHECKS_TTL, () =>
      json('gh', ['pr', 'view', String(number), '-R', repo, '--json', PR_FIELDS])
    )) ?? {}
  const state = view.state ?? chosen.state
  const url = view.url ?? chosen.url
  if (!url) return null
  const { checks, failed, progress } = checksOf(view.statusCheckRollup)
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
    progress,
    conflict: view.mergeable === 'CONFLICTING',
    review: view.reviewDecision ?? null,
    issues: (view.closingIssuesReferences ?? []).map((reference) => reference.number)
  }
}

/**
 * The pull requests the record carries for one repository. A session works in more than the copy it
 * was opened in, and a number from the other one read here would answer about somebody else's work.
 */
function recordedIn(record: SessionRecord, repo: string): NonNullable<SessionRecord['prs']> {
  return (record.prs ?? []).filter((pr) => !pr.repo || pr.repo === repo)
}

/** Every pull request a session has open beside it, not only the one it is standing on. */
export async function githubPrs(repo: string, record: SessionRecord): Promise<Change[]> {
  const mine = recordedIn(record, repo)
  const numbers = [...new Set(mine.map((pr) => pr.prNumber).filter(Boolean))] as number[]
  if (numbers.length === 0) {
    const one = await githubPr(repo, record)
    return one ? [one] : []
  }
  const found = await Promise.all(
    numbers.map((number) => viewPr(repo, number, mine.find((pr) => pr.prNumber === number) ?? {}))
  )
  return found.filter((change): change is Change => change !== null)
}

export async function githubPr(repo: string, record: SessionRecord): Promise<Change | null> {
  const recorded = recordedIn(record, repo).filter((pr) => pr.prNumber)
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
  return viewPr(repo, number, chosen)
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
          { env: { GITLAB_HOST: host } }
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
        progress: { done: 0, total: 0, failed: 0, since: null, until: null },
        conflict: Boolean(mr.has_conflicts),
        review: null,
        issues: []
      }
    }
  }
  return null
}
