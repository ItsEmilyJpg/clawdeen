import { describe, expect, it } from 'vitest'

import {
  byProject,
  hiddenTally,
  movedProject,
  ordered,
  visible,
  withProject
} from '../src/shared/projects'
import type { Session } from '../src/shared/types'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'one',
    cli: 'claude',
    title: 'one',
    headline: 'one',
    place: 'clawdeen · main',
    project: 'clawdeen',
    last: 1789219700,
    active: true,
    issue: null,
    change: null,
    changes: [],
    state: 'no-pr',
    activity: null,
    extra: null,
    about: null,
    since: null,
    action: null,
    entered: null,
    heard: null,
    pinned: false,
    focused: false,
    ...over
  }
}

describe('visible', () => {
  const rows = [
    session({ id: 'a', project: 'clawdeen' }),
    session({ id: 'b', project: 'notes' }),
    session({ id: 'c', project: 'notes' })
  ]

  it('draws everything while nothing is switched off', () => {
    expect(visible(rows, []).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  it('leaves out the repositories that are', () => {
    expect(visible(rows, ['notes']).map((one) => one.id)).toEqual(['a'])
  })

  it('says nothing at all where every repository is off', () => {
    expect(visible(rows, ['clawdeen', 'notes'])).toEqual([])
  })

  it('ignores a name no session carries', () => {
    expect(visible(rows, ['website']).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('hiddenTally', () => {
  it('counts nothing while nothing is switched off', () => {
    expect(hiddenTally([session()], [])).toEqual({ count: 0, waiting: 0 })
  })

  it('counts what is behind the filter', () => {
    const rows = [session({ project: 'notes' }), session({ project: 'notes' }), session()]
    expect(hiddenTally(rows, ['notes'])).toEqual({ count: 2, waiting: 0 })
  })

  /**
   * The one that decides whether any of this may exist. A session waiting for an answer inside a
   * repository nobody is looking at must still be counted, or the filter turns the board into
   * something that lies by leaving things out.
   */
  it('still counts a session waiting for an answer inside a hidden repository', () => {
    const rows = [
      session({ id: 'a', project: 'notes', activity: 'waiting-for-you' }),
      session({ id: 'b', project: 'notes', activity: 'working' }),
      session({ id: 'c', project: 'clawdeen', activity: 'waiting-for-you' })
    ]
    expect(visible(rows, ['notes']).map((one) => one.id)).toEqual(['c'])
    expect(hiddenTally(rows, ['notes'])).toEqual({ count: 2, waiting: 1 })
  })
})

describe('withProject', () => {
  it('switches one off', () => {
    expect(withProject([], 'notes', false)).toEqual(['notes'])
  })

  it('switches one back on', () => {
    expect(withProject(['clawdeen', 'notes'], 'notes', true)).toEqual(['clawdeen'])
  })

  it('keeps the list sorted, so the stored file does not churn', () => {
    expect(withProject(['notes'], 'clawdeen', false)).toEqual(['clawdeen', 'notes'])
  })

  it('switching off what is already off changes nothing', () => {
    expect(withProject(['notes'], 'notes', false)).toEqual(['notes'])
  })
})

describe('ordered', () => {
  const seen = ['clawdeen', 'notes', 'website']

  it('leaves the alphabet alone while she has arranged nothing', () => {
    expect(ordered(seen, [])).toEqual(seen)
  })

  it('reads them back in the order she dragged them into', () => {
    expect(ordered(seen, ['website', 'clawdeen', 'notes'])).toEqual([
      'website',
      'clawdeen',
      'notes'
    ])
  })

  /**
   * The one that decides whether a stored order may exist at all. A repository opened for the first
   * time has never been dragged anywhere, and putting it in the middle would move a list she
   * arranged herself. It goes behind what she arranged, alphabetically among its own kind.
   */
  it('puts a repository she has never moved behind the ones she has', () => {
    expect(ordered(['clawdeen', 'fresh', 'notes'], ['notes', 'clawdeen'])).toEqual([
      'notes',
      'clawdeen',
      'fresh'
    ])
  })

  it('ignores a name no session carries any more', () => {
    expect(ordered(['clawdeen'], ['gone', 'clawdeen'])).toEqual(['clawdeen'])
  })
})

describe('movedProject', () => {
  const seen = ['clawdeen', 'notes', 'website']

  it('moves one up', () => {
    expect(movedProject(seen, 'website', 'clawdeen')).toEqual(['website', 'clawdeen', 'notes'])
  })

  it('moves one down', () => {
    expect(movedProject(seen, 'clawdeen', 'website')).toEqual(['notes', 'website', 'clawdeen'])
  })

  it('dropping one onto itself changes nothing', () => {
    expect(movedProject(seen, 'notes', 'notes')).toBe(seen)
  })

  it('a name that is not there changes nothing', () => {
    expect(movedProject(seen, 'gone', 'notes')).toBe(seen)
  })
})

describe('byProject', () => {
  it('says nothing while she has arranged nothing, so a lane sorts as it always did', () => {
    const flat = byProject([])
    expect(flat('notes', 'clawdeen')).toBe(0)
  })

  it('sorts by where she put the repository', () => {
    const order = byProject(['website', 'clawdeen'])
    expect(['clawdeen', 'website'].sort(order)).toEqual(['website', 'clawdeen'])
  })

  it('leaves a repository she never moved behind the ones she did', () => {
    const order = byProject(['website'])
    expect(order('fresh', 'website')).toBeGreaterThan(0)
    expect(order('fresh', 'other')).toBe(0)
  })
})
