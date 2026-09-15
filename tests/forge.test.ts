import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isPullRequest, notFound } from '../src/main/forge'

const gh = vi.hoisted(() => ({
  calls: 0,
  answer: (): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: 'true', stderr: '' })
}))

// promisify(execFile) goes through the custom symbol, so that is what the fake has to carry.
vi.mock('node:child_process', async () => {
  const { promisify: custom } = await import('node:util')
  const execFile = Object.assign(() => undefined, {
    [custom.custom]: () => {
      gh.calls += 1
      return gh.answer()
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
