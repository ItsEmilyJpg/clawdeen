import { describe, expect, it } from 'vitest'

import { waitingOn } from '../src/main/board'
import { checksOf } from '../src/main/forge'
import { openSession } from '../src/main/records'
import { burnOf, burnVerdict, repoColour, stateLabel } from '../src/shared/words'
import { LANES } from '../src/renderer/src/words'
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
    progress: { done: 0, total: 0, failed: 0, since: null, until: null },
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
      since: Date.parse('2026-09-12T08:00:00Z') / 1000,
      until: null
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
      progress: { done: 0, total: 0, failed: 0, since: null, until: null }
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
    const progress = { done: 1, total: 4, failed: 1, since: null, until: null }
    expect(stateLabel('CI červené', change({ progress }))).toBe('CI červené 1/4')
  })

  it('says how long ago a finished run finished', () => {
    const until = Date.now() / 1000 - 14 * 60
    const progress = { done: 4, total: 4, failed: 1, since: null, until }
    expect(stateLabel('CI červené', change({ progress }))).toBe('CI červené · před 14 min')
  })

  it('says the word alone when a finished run kept no time', () => {
    const progress = { done: 4, total: 4, failed: 1, since: null, until: null }
    expect(stateLabel('CI červené', change({ progress }))).toBe('CI červené')
  })

  it('counts a fresh run in seconds rather than in zero minutes', () => {
    const progress = { done: 0, total: 3, failed: 0, since: Date.now() / 1000 - 20, until: null }
    expect(stateLabel('CI běží', change({ progress }))).toBe('CI běží 0/3 · 20 s')
  })

  it('says the word alone where there is no run', () => {
    expect(stateLabel('bez PR', null)).toBe('bez PR')
  })
})

describe('burnOf', () => {
  const fiveHours = 300

  it('says how long the window lasts at the pace so far', () => {
    // A quarter of the window gone and a fifth of it spent: the rest lasts four times as long again.
    const left = 225 * 60
    expect(burnOf(20, left, fiveHours)).toBe(4 * 75 * 60)
  })

  it('has nothing to run out of before anything is spent', () => {
    expect(burnOf(0, 200 * 60, fiveHours)).toBeNull()
  })

  it('has nothing to say at the very start of a window', () => {
    expect(burnOf(5, fiveHours * 60, fiveHours)).toBeNull()
  })
})

describe('burnVerdict', () => {
  it('is green while the window outlives its reset', () => {
    expect(burnVerdict(3 * 3600, 2 * 3600)).toBe('ok')
  })

  it('is amber just short of the reset', () => {
    expect(burnVerdict(2 * 3600 - 60, 2 * 3600)).toBe('warn')
  })

  it('is red when the window runs out first', () => {
    expect(burnVerdict(3600, 3 * 3600)).toBe('danger')
  })

  it('is green where nothing has been spent', () => {
    expect(burnVerdict(null, 3600)).toBe('ok')
  })
})

describe('waitingOn', () => {
  const idle = { word: 'čeká na tebe' as const, since: null, extra: null, idle: true }

  it('waits on the run, not on her, where the turn is over and the checks are going', () => {
    expect(waitingOn(idle, change({ checks: 'CI běží' }))).toBe('čeká na CI')
  })

  it('keeps ringing where the session asked something, whatever the run does', () => {
    const asking = { word: 'čeká na tebe' as const, since: null, extra: null }
    expect(waitingOn(asking, change({ checks: 'CI běží' }))).toBe('čeká na tebe')
  })

  it('is hers again once the run goes red', () => {
    expect(waitingOn(idle, change({ checks: 'CI červené' }))).toBe('čeká na tebe')
  })

  it('is hers where there is no change at all', () => {
    expect(waitingOn(idle, null)).toBe('čeká na tebe')
  })

  it('leaves a session that is working alone', () => {
    const working = { word: 'pracuje' as const, since: null, extra: null }
    expect(waitingOn(working, change({ checks: 'CI běží' }))).toBe('pracuje')
  })

  it('says nothing where the session said nothing', () => {
    expect(
      waitingOn({ word: null, since: null, extra: null }, change({ checks: 'CI běží' }))
    ).toBeNull()
  })
})

describe('LANES', () => {
  it('keeps the CI wait under everything that is still hers', () => {
    const words = LANES.map((lane) => lane.word)
    expect(words).toContain('čeká na CI')
    expect(words.indexOf('čeká na CI')).toBeGreaterThan(words.indexOf('čeká na tebe'))
    expect(words.at(-1)).toBeNull()
  })
})

describe('openSession', () => {
  it('is the one focused last, whatever the sessions have been doing since', () => {
    expect(
      openSession([
        { sessionId: 'first', lastFocusedAt: 1789219744000, lastActivityAt: 1789219749000 },
        { sessionId: 'focused', lastFocusedAt: 1789219749433, lastActivityAt: 1789219726431 },
        { sessionId: 'busy', lastFocusedAt: 1789219700000, lastActivityAt: 1789219800000 }
      ])
    ).toBe('focused')
  })

  it('claims nothing where no record carries the field', () => {
    expect(openSession([{ sessionId: 'one', lastActivityAt: 1789219726431 }])).toBeNull()
  })

  it('claims nothing without a session at all', () => {
    expect(openSession([])).toBeNull()
  })
})

describe('repoColour', () => {
  it('gives one repository the same colour every time', () => {
    expect(repoColour('notes')).toBe(repoColour('notes'))
  })

  it('tells the repositories on this machine apart', () => {
    const names = ['notes', 'claude-sessions', 'examplecorp']
    expect(new Set(names.map(repoColour)).size).toBe(names.length)
  })

  it('answers with a colour even for a name that says nothing', () => {
    expect(repoColour('')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
