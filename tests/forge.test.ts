import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gitlabMr, isPullRequest, notFound, remote, workingCopy } from '../src/main/forge'
import type { SessionRecord } from '../src/main/records'

/** What the fake shell answers, given the arguments the call was made with. */
type Answer = (args?: string[]) => Promise<{ stdout: string; stderr: string }>

const gh = vi.hoisted(() => ({
  calls: 0,
  answer: ((): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: 'true', stderr: '' })) as Answer
}))

// promisify(execFile) goes through the custom symbol, so that is what the fake has to carry.
vi.mock('node:child_process', async () => {
  const { promisify: custom } = await import('node:util')
  const execFile = Object.assign(() => undefined, {
    [custom.custom]: (_command: string, args: string[]) => {
      gh.calls += 1
      return gh.answer(args)
    }
  })
  return { execFile }
})

/** The error execFile rejects with, in the shapes measured off gh and node on 15 September 2026. */
function failure(over: { code?: number | string | null; signal?: string; stderr: string }): Error {
  return Object.assign(new Error('Command failed'), over)
}

const NOT_FOUND = failure({ code: 1, stderr: 'gh: Not Found (HTTP 404)\n' })
const BAD_TOKEN = failure({ code: 1, stderr: 'gh: Bad credentials (HTTP 401)\n' })
const RATE_LIMIT = failure({
  code: 1,
  stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)\n'
})
const NO_GH = failure({ code: 'ENOENT', stderr: '' })
const TIMEOUT = failure({ code: null, signal: 'SIGTERM', stderr: '' })

describe('notFound', () => {
  it('reads a 404 as an answer', () => {
    expect(notFound(NOT_FOUND)).toBe(true)
  })

  it('reads every other failure as saying nothing about the number', () => {
    for (const error of [BAD_TOKEN, RATE_LIMIT, NO_GH, TIMEOUT, undefined, 'text']) {
      expect(notFound(error)).toBe(false)
    }
  })
})

describe('isPullRequest', () => {
  let repo = 0

  beforeEach(() => {
    gh.calls = 0
    // Every test asks a repository of its own, so the cache one test fills never answers another.
    repo += 1
  })

  it('asks GitHub once about a number that is not in the repository', async () => {
    gh.answer = () => Promise.reject(NOT_FOUND)
    expect(await isPullRequest(`owner/missing-${repo}`, 916)).toBe(false)
    expect(await isPullRequest(`owner/missing-${repo}`, 916)).toBe(false)
    expect(gh.calls).toBe(1)
  })

  it('asks again after a failure that says nothing about the number', async () => {
    for (const error of [BAD_TOKEN, RATE_LIMIT, NO_GH, TIMEOUT]) {
      gh.calls = 0
      gh.answer = () => Promise.reject(error)
      expect(await isPullRequest(`owner/failing-${repo}`, 916)).toBe(false)
      expect(await isPullRequest(`owner/failing-${repo}`, 916)).toBe(false)
      expect(gh.calls).toBe(2)
    }
  })

  it('asks again once the hour a missing number is believed for has passed', async () => {
    vi.useFakeTimers()
    try {
      gh.answer = () => Promise.reject(NOT_FOUND)
      await isPullRequest(`owner/later-${repo}`, 70)
      vi.advanceTimersByTime(3601 * 1000)
      gh.answer = () => Promise.resolve({ stdout: 'true', stderr: '' })
      expect(await isPullRequest(`owner/later-${repo}`, 70)).toBe(true)
      expect(gh.calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a pull request for longer than a missing number', async () => {
    vi.useFakeTimers()
    try {
      gh.answer = () => Promise.resolve({ stdout: 'true', stderr: '' })
      await isPullRequest(`owner/kept-${repo}`, 12)
      vi.advanceTimersByTime(3601 * 1000)
      expect(await isPullRequest(`owner/kept-${repo}`, 12)).toBe(true)
      expect(gh.calls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

/** A sweep starts every session's lookups in the same tick, which is what seven calls here stand for. */
function together<T>(ask: () => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: 7 }, ask))
}

describe('a lookup still being asked', () => {
  let key = 0

  beforeEach(() => {
    gh.calls = 0
    key += 1
  })

  it('is asked once by sessions of one repository at the same time', async () => {
    gh.answer = () => Promise.resolve({ stdout: 'true', stderr: '' })
    expect(await together(() => isPullRequest(`owner/together-${key}`, 99999))).toEqual(
      Array(7).fill(true)
    )
    expect(gh.calls).toBe(1)
  })

  it('is asked once again when the answer it holds has expired', async () => {
    vi.useFakeTimers()
    try {
      gh.answer = () => Promise.reject(NOT_FOUND)
      await isPullRequest(`owner/expired-${key}`, 70)
      vi.advanceTimersByTime(3601 * 1000)
      gh.answer = () => Promise.resolve({ stdout: 'true', stderr: '' })
      expect(await together(() => isPullRequest(`owner/expired-${key}`, 70))).toEqual(
        Array(7).fill(true)
      )
      expect(gh.calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is forgotten once it fails, so the next sweep asks again', async () => {
    gh.answer = () => Promise.reject(RATE_LIMIT)
    await together(() => isPullRequest(`owner/failed-${key}`, 916))
    expect(gh.calls).toBe(1)
    await isPullRequest(`owner/failed-${key}`, 916)
    expect(gh.calls).toBe(2)
  })

  it('hands every waiting session the last good answer when the refresh fails', async () => {
    vi.useFakeTimers()
    try {
      gh.answer = () => Promise.resolve({ stdout: 'true', stderr: '' })
      await isPullRequest(`owner/fallback-${key}`, 12)
      vi.advanceTimersByTime(31 * 86400 * 1000)
      gh.answer = () => Promise.reject(RATE_LIMIT)
      expect(await together(() => isPullRequest(`owner/fallback-${key}`, 12))).toEqual(
        Array(7).fill(true)
      )
      expect(gh.calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the working copy of one directory once', async () => {
    gh.answer = () => Promise.resolve({ stdout: `/copy-${key}\n`, stderr: '' })
    expect(await together(() => workingCopy(`/copy-${key}/src`))).toEqual(
      Array(7).fill(`/copy-${key}`)
    )
    expect(gh.calls).toBe(1)
  })

  it('reads the origin of one working copy once, and asks again after a failure', async () => {
    gh.answer = () => Promise.reject(NO_GH)
    expect(await together(() => remote(`/origin-${key}`))).toEqual(
      Array(7).fill({ host: null, project: null })
    )
    expect(gh.calls).toBe(1)
    gh.answer = () => Promise.resolve({ stdout: 'git@github.com:owner/repo.git\n', stderr: '' })
    expect(await together(() => remote(`/origin-${key}`))).toEqual(
      Array(7).fill({ host: 'github.com', project: 'owner/repo' })
    )
    expect(gh.calls).toBe(2)
  })
})

/**
 * The GitLab side, where a merge request is three questions: the branch's merge request, the merge
 * request itself for the run standing on it, and that run's jobs.
 */
describe('gitlabMr reads the run on a merge request', () => {
  let project = 0

  const asked = (args: string[] | undefined, what: string): boolean =>
    (args ?? []).some((argument) => argument.includes(what))

  /** One session standing on a branch, which is all `branches()` needs to ask about it. */
  const onBranch = (branch: string): SessionRecord => ({ sessionId: 'one', branch })

  /** glab answering the three calls in turn, with the jobs the test is about. */
  const forge =
    (jobs: unknown[], pipeline: unknown = { id: 25212, status: 'running' }) =>
    (args?: string[]): Promise<{ stdout: string; stderr: string }> => {
      const mr = {
        iid: 9249,
        web_url: 'https://gitlab.example.com/group/repo/-/merge_requests/9249',
        state: 'opened',
        source_branch: 'feature/one',
        has_conflicts: false
      }
      if (asked(args, '/jobs')) return Promise.resolve({ stdout: JSON.stringify(jobs), stderr: '' })
      if (asked(args, '/merge_requests/')) {
        return Promise.resolve({
          stdout: JSON.stringify({ ...mr, head_pipeline: pipeline }),
          stderr: ''
        })
      }
      return Promise.resolve({ stdout: JSON.stringify([mr]), stderr: '' })
    }

  const job = (over: Record<string, unknown>): Record<string, unknown> => ({
    name: 'test:php',
    status: 'success',
    allow_failure: false,
    web_url: 'https://gitlab.example.com/group/repo/-/jobs/1',
    started_at: '2026-09-17T08:00:00.000Z',
    finished_at: '2026-09-17T08:10:00.000Z',
    ...over
  })

  beforeEach(() => {
    gh.calls = 0
    // Every test asks a project of its own, so the cache one test fills never answers another.
    project += 1
  })

  it('says a run is going, and how far it has got', async () => {
    gh.answer = forge([
      job({ name: 'lint:phpcs' }),
      job({ name: 'test:php', status: 'running', finished_at: null })
    ])
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/running-${project}`,
      onBranch('feature/one')
    )
    expect(change?.token).toBe('MR !9249')
    expect(change?.checks).toBe('ci-running')
    expect(change?.progress).toEqual({
      done: 1,
      total: 2,
      failed: 0,
      since: Date.parse('2026-09-17T08:00:00.000Z') / 1000,
      until: null
    })
  })

  it('names the job that failed, with the link to it', async () => {
    gh.answer = forge([
      job({ name: 'lint:phpcs', status: 'failed', web_url: 'https://gitlab.example.com/jobs/7' }),
      job({ name: 'test:php' })
    ])
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/red-${project}`,
      onBranch('feature/one')
    )
    expect(change?.checks).toBe('ci-red')
    expect(change?.failed).toEqual([
      { label: 'lint:phpcs', url: 'https://gitlab.example.com/jobs/7' }
    ])
    expect(change?.progress.until).toBe(Date.parse('2026-09-17T08:10:00.000Z') / 1000)
  })

  it('leaves a job the pipeline allows to fail out of the red, and counts it as over', async () => {
    gh.answer = forge([job({ name: 'aws:deploy', status: 'failed', allow_failure: true })])
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/allowed-${project}`,
      onBranch('feature/one')
    )
    expect(change?.checks).toBe(null)
    expect(change?.failed).toEqual([])
    expect(change?.progress.done).toBe(1)
  })

  /** Measured on this GitLab: six green, one manual, and one created behind it that never starts. */
  it('does not call a stopped run running because a job behind a manual one is waiting', async () => {
    gh.answer = forge(
      [
        job({ name: 'test:php' }),
        job({ name: 'deploy', status: 'manual', started_at: null, finished_at: null }),
        job({
          name: 'aws:k8s-deploy',
          status: 'created',
          allow_failure: true,
          started_at: null,
          finished_at: null
        })
      ],
      { id: 25210, status: 'manual' }
    )
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/manual-${project}`,
      onBranch('feature/one')
    )
    expect(change?.checks).toBe(null)
    expect(change?.progress.done).toBe(3)
  })

  it('still says a run is going while the pipeline itself says so', async () => {
    gh.answer = forge(
      [
        job({ name: 'test:php' }),
        job({ name: 'test:cypress', status: 'created', finished_at: null })
      ],
      { id: 25212, status: 'running' }
    )
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/going-${project}`,
      onBranch('feature/one')
    )
    expect(change?.checks).toBe('ci-running')
    expect(change?.progress).toMatchObject({ done: 1, total: 2 })
  })

  it('asks nothing about jobs where the merge request carries no run', async () => {
    gh.answer = forge([], null)
    const change = await gitlabMr(
      'gitlab.example.com',
      `group/nopipe-${project}`,
      onBranch('feature/one')
    )
    expect(change?.checks).toBe(null)
    expect(change?.progress).toEqual({ done: 0, total: 0, failed: 0, since: null, until: null })
    expect(gh.calls).toBe(2)
  })
})
