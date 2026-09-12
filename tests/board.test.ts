import { describe, expect, it } from 'vitest'

import { checksOf } from '../src/main/forge'
import { stateLabel } from '../src/shared/words'
import type { Change } from '../src/shared/types'

function change(over: Partial<Change> = {}): Change {
  return {
    label: 'PR #1',
    token: 'PR #1',
    url: 'https://example.test/1',
    state: 'otevřené',
    open: true,
    draft: false,
    branch: 'feature/one',
    checks: null,
    failed: [],
    progress: { done: 0, total: 0, failed: 0, since: null },
    conflict: false,
    review: null,
    issues: [],
    ...over
  }
}

describe('checksOf', () => {
  it('counts what is done and names what failed', () => {
    const { checks, failed, progress } = checksOf([
      { conclusion: 'SUCCESS', name: 'lint', startedAt: '2026-09-12T08:00:00Z' },
      { conclusion: 'FAILURE', name: 'integration', detailsUrl: 'https://example.test/job' },
      { status: 'IN_PROGRESS', name: 'checks', startedAt: '2026-09-12T08:01:00Z' }
    ])
    expect(checks).toBe('CI červené')
    expect(failed).toEqual([{ label: 'integration', url: 'https://example.test/job' }])
    expect(progress).toEqual({
      done: 2,
      total: 3,
      failed: 1,
      since: Date.parse('2026-09-12T08:00:00Z') / 1000
    })
  })

  it('is running while a check has no verdict and nothing failed', () => {
    expect(checksOf([{ status: 'QUEUED', name: 'checks' }]).checks).toBe('CI běží')
  })

  it('says nothing when every check passed', () => {
    expect(checksOf([{ conclusion: 'SUCCESS' }]).checks).toBeNull()
  })

  it('has no run at all without a rollup', () => {
    expect(checksOf(undefined)).toEqual({
      checks: null,
      failed: [],
      progress: { done: 0, total: 0, failed: 0, since: null }
    })
  })
})

describe('stateLabel', () => {
  it('carries the count and the elapsed time while the checks run', () => {
    const since = Date.now() / 1000 - 8 * 60
    const label = stateLabel(
      'CI běží',
      change({ progress: { done: 2, total: 5, failed: 0, since } })
    )
    expect(label).toBe('CI běží 2/5 · 8 min')
  })

  it('keeps the count on a red run that is not over', () => {
    const progress = { done: 1, total: 4, failed: 1, since: null }
    expect(stateLabel('CI červené', change({ progress }))).toBe('CI červené 1/4')
  })

  it('says the word alone once every check is in', () => {
    const progress = { done: 4, total: 4, failed: 1, since: null }
    expect(stateLabel('CI červené', change({ progress }))).toBe('CI červené')
  })

  it('says the word alone where there is no run', () => {
    expect(stateLabel('bez PR', null)).toBe('bez PR')
  })
})
