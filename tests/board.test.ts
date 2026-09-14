import { describe, expect, it } from 'vitest'

import { waitingOn } from '../src/main/board'
import { checksOf } from '../src/main/forge'
import { openSession } from '../src/main/records'
import {
  burnOf,
  burnVerdict,
  doubtsOf,
  refreshVerdict,
  repoColour,
  stateLabel,
  usageRows
} from '../src/shared/words'
import { inLane, LANE_WORDS, laneRows } from '../src/renderer/src/words'
import { asStateWord, everyStateWord, money, setLocale, stateWord } from '../src/shared/i18n'
import type { Change, Session, StateWord, UsageWindow } from '../src/shared/types'

function change(over: Partial<Change> = {}): Change {
  return {
    label: 'PR #1',
    token: 'PR #1',
    url: 'https://example.test/1',
    state: 'open',
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
    expect(checks).toBe('ci-red')
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
    expect(checksOf([{ status: 'QUEUED', name: 'checks' }]).checks).toBe('ci-running')
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
      'ci-running',
      change({ progress: { done: 2, total: 5, failed: 0, since } })
    )
    expect(label).toBe('CI running 2/5 · 8 min')
  })

  it('keeps the count on a red run that is not over', () => {
    const progress = { done: 1, total: 4, failed: 1, since: null, until: null }
    expect(stateLabel('ci-red', change({ progress }))).toBe('CI red 1/4')
  })

  it('says how long ago a finished run finished', () => {
    const until = Date.now() / 1000 - 14 * 60
    const progress = { done: 4, total: 4, failed: 1, since: null, until }
    expect(stateLabel('ci-red', change({ progress }))).toBe('CI red · 14 min ago')
  })

  it('says the word alone when a finished run kept no time', () => {
    const progress = { done: 4, total: 4, failed: 1, since: null, until: null }
    expect(stateLabel('ci-red', change({ progress }))).toBe('CI red')
  })

  it('counts a fresh run in seconds rather than in zero minutes', () => {
    const progress = { done: 0, total: 3, failed: 0, since: Date.now() / 1000 - 20, until: null }
    expect(stateLabel('ci-running', change({ progress }))).toBe('CI running 0/3 · 20 s')
  })

  it('says the word alone where there is no run', () => {
    expect(stateLabel('no-pr', null)).toBe('no PR')
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

describe('refreshVerdict', () => {
  const at = 1789219700

  it('is green while the board is still being swept', () => {
    expect(refreshVerdict(at, at + 14)).toBe('ok')
    expect(refreshVerdict(at, at + 45)).toBe('ok')
  })

  it('is amber once a sweep has gone missing', () => {
    expect(refreshVerdict(at, at + 46)).toBe('warn')
    expect(refreshVerdict(at, at + 90)).toBe('warn')
  })

  /** The one that earns the colour: a window nobody is refreshing still prints a plausible time. */
  it('is red once nothing is reading the board any more', () => {
    expect(refreshVerdict(at, at + 91)).toBe('danger')
    expect(refreshVerdict(at, at + 3600)).toBe('danger')
  })

  it('is green on a board read this instant', () => {
    expect(refreshVerdict(at, at)).toBe('ok')
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

describe('doubtsOf', () => {
  function window(over: Partial<UsageWindow> = {}): UsageWindow {
    return {
      key: 'five_hour',
      label: '5 hodin',
      short: '5 h',
      used: 89,
      resets: 0,
      left: 3600,
      pace: null,
      burn: null,
      stale: null,
      error: null,
      otherAccount: null,
      ...over
    }
  }

  it('says nothing about a window that was just read', () => {
    expect(doubtsOf(window())).toEqual([])
  })

  it('says how old the number is', () => {
    expect(doubtsOf(window({ stale: 35 * 60 }))).toEqual(['read 35 min ago'])
  })

  it('says why it could not be refreshed, before whose it is', () => {
    const doubts = doubtsOf(
      window({ stale: 20 * 60, error: 'token vypršel', otherAccount: 'a@b.cz · Jiná' })
    )
    expect(doubts).toEqual([
      'read 20 min ago',
      'not refreshed: token vypršel',
      'account a@b.cz · Jiná'
    ])
  })

  it('says whose the number is even where it is otherwise current', () => {
    expect(doubtsOf(window({ otherAccount: 'a@b.cz · Jiná' }))).toEqual(['account a@b.cz · Jiná'])
  })
})

describe('usageRows', () => {
  function window(over: Partial<UsageWindow> = {}): UsageWindow {
    return {
      key: 'five_hour',
      label: '5 hodin',
      short: '5 h',
      used: 42,
      resets: 0,
      left: 3600,
      pace: null,
      burn: 7200,
      stale: null,
      error: null,
      otherAccount: null,
      ...over
    }
  }

  it('gives one row per window and none of its own where nothing is doubted', () => {
    const rows = usageRows([window(), window({ key: 'seven_day', short: '7 d' })])
    expect(rows.map((row) => row.label)).toEqual([
      '5 h 42 % · spent in 2 h 0 min · resets in 1 h 0 min',
      '7 d 42 % · spent in 2 h 0 min · resets in 1 h 0 min'
    ])
    expect(rows.every((row) => row.window !== null)).toBe(true)
  })

  it('says the doubt once under both windows, not on each of them', () => {
    const doubt = { otherAccount: 'a@b.cz · Jiná' }
    const rows = usageRows([window(doubt), window({ ...doubt, key: 'seven_day', short: '7 d' })])
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.label.includes('a@b.cz'))).toHaveLength(1)
    expect(rows.at(-1)).toEqual({ label: 'account a@b.cz · Jiná', window: null })
  })

  it('keeps the reset on a doubted window and drops what it burns', () => {
    const [row] = usageRows([window({ stale: 40 * 60 })])
    expect(row.label).toBe('5 h 42 % · resets in 1 h 0 min')
  })

  it('has nothing to show without a window', () => {
    expect(usageRows([])).toEqual([])
  })
})

describe('waitingOn', () => {
  const idle = { word: 'waiting-for-you' as const, since: null, extra: null, idle: true }

  it('waits on the run, not on her, where the turn is over and the checks are going', () => {
    expect(waitingOn(idle, change({ checks: 'ci-running' }))).toBe('waiting-for-ci')
  })

  it('keeps ringing where the session asked something, whatever the run does', () => {
    const asking = { word: 'waiting-for-you' as const, since: null, extra: null }
    expect(waitingOn(asking, change({ checks: 'ci-running' }))).toBe('waiting-for-you')
  })

  it('is hers again once the run goes red', () => {
    expect(waitingOn(idle, change({ checks: 'ci-red' }))).toBe('waiting-for-you')
  })

  it('is hers where there is no change at all', () => {
    expect(waitingOn(idle, null)).toBe('waiting-for-you')
  })

  it('leaves a session that is working alone', () => {
    const working = { word: 'working' as const, since: null, extra: null }
    expect(waitingOn(working, change({ checks: 'ci-running' }))).toBe('working')
  })

  it('says nothing where the session said nothing', () => {
    expect(
      waitingOn({ word: null, since: null, extra: null }, change({ checks: 'ci-running' }))
    ).toBeNull()
  })
})

describe('lanes', () => {
  it('keeps the CI wait under everything that is still hers', () => {
    const words = LANE_WORDS
    expect(words).toContain('waiting-for-ci')
    expect(words.indexOf('waiting-for-ci')).toBeGreaterThan(words.indexOf('waiting-for-you'))
    expect(words.at(-1)).toBeNull()
  })

  it('names every lane, the leftover one included', () => {
    const titles = laneRows().map((lane) => lane.title)
    expect(titles).toContain('waiting for you')
    expect(titles.at(-1)).toBe('other')
  })
})

describe('the words a title can end with', () => {
  it('knows every language and the ones from before the states became keys', () => {
    const words = everyStateWord()
    expect(words).toContain('waiting-for-you')
    expect(words).toContain('waiting for you')
    expect(words).toContain('čeká na tebe')
  })

  it('reads an old Czech stretch back as the key it means', () => {
    expect(asStateWord('čeká na tebe')).toBe('waiting-for-you')
    expect(asStateWord('waiting-for-you')).toBe('waiting-for-you')
  })

  it('says nothing about a word no version ever wrote', () => {
    expect(asStateWord('kdovíco')).toBeNull()
  })

  it('hands back a word it does not know rather than throwing', () => {
    expect(stateWord('kdovíco' as StateWord)).toBe('kdovíco')
  })

  it('says the same state in the other language', () => {
    setLocale('cs')
    expect(stateWord('waiting-for-you')).toBe('čeká na tebe')
    setLocale('en')
    expect(stateWord('waiting-for-you')).toBe('waiting for you')
  })
})

describe('money', () => {
  // The space Czech puts before the symbol is a non-breaking one, written here as an escape so that
  // nobody 'fixes' it into an ordinary space and spends an afternoon on two strings that look equal.
  it('points the amount the way the language points it', () => {
    setLocale('cs')
    expect(money(38626, 'EUR', 2)).toBe('386,26 €')
    setLocale('en')
    expect(money(38626, 'EUR', 2)).toBe('€386.26')
  })

  it('counts in the places the answer gives, not in two by habit', () => {
    setLocale('en')
    expect(money(38626, 'USD', 0)).toBe('$38,626')
    expect(money(38626, 'USD', 3)).toBe('$38.626')
  })

  // The currency comes off the wire, so a code Intl has never heard of is a thing that can arrive.
  it('still says the amount when the currency is not one Intl knows', () => {
    setLocale('cs')
    expect(money(38626, 'kredit', 2)).toBe('386,26 kredit')
    setLocale('en')
    expect(money(38626, 'kredit', 2)).toBe('386.26 kredit')
  })
})

describe('inLane', () => {
  function session(over: Partial<Session> = {}): Session {
    return {
      id: 'one',
      cli: 'claude',
      title: 'one',
      headline: 'one',
      place: 'repo',
      project: 'repo',
      last: 1789219700,
      active: true,
      issue: null,
      change: null,
      changes: [],
      state: 'no-pr',
      activity: 'working',
      extra: null,
      about: null,
      since: null,
      action: null,
      entered: 1789219000,
      heard: null,
      pinned: false,
      focused: false,
      ...over
    }
  }

  it('stands by how long a card has been in the state, not by what moved last', () => {
    const older = session({ id: 'older', entered: 1789210000, last: 1789219000 })
    const newer = session({ id: 'newer', entered: 1789219000, last: 1789219900 })
    expect([newer, older].sort(inLane([])).map((one) => one.id)).toEqual(['older', 'newer'])
  })

  it('does not move a card because its session just did something', () => {
    const one = session({ id: 'one', entered: 1789210000, last: 1789219000 })
    const other = session({ id: 'other', entered: 1789219000, last: 1789219100 })
    const before = [one, other].sort(inLane([])).map((row) => row.id)
    other.last = 1789229999
    expect([one, other].sort(inLane([])).map((row) => row.id)).toEqual(before)
  })

  it('keeps what she dragged and what she pinned in front', () => {
    const dragged = session({ id: 'dragged', entered: 1789219900 })
    const held = session({ id: 'held', entered: 1789219800, pinned: true })
    const oldest = session({ id: 'oldest', entered: 1789210000 })
    expect([oldest, held, dragged].sort(inLane(['dragged'])).map((one) => one.id)).toEqual([
      'dragged',
      'held',
      'oldest'
    ])
  })

  it('groups a lane by the repositories in the order she arranged them', () => {
    const first = session({ id: 'first', project: 'website', entered: 1789219900 })
    const second = session({ id: 'second', project: 'clawdeen', entered: 1789210000 })
    const third = session({ id: 'third', project: 'clawdeen', entered: 1789219000 })
    const rows = [second, third, first]
    expect(rows.sort(inLane([], ['website', 'clawdeen'])).map((one) => one.id)).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  /** The order she arranged is hers, but a card she pinned is one she said to keep on top. */
  it('keeps a pinned card above the repository order', () => {
    const pinned = session({ id: 'pinned', project: 'clawdeen', pinned: true })
    const first = session({ id: 'first', project: 'website' })
    expect([first, pinned].sort(inLane([], ['website', 'clawdeen'])).map((one) => one.id)).toEqual([
      'pinned',
      'first'
    ])
  })

  it('sorts as it always did while she has arranged no repositories', () => {
    const older = session({ id: 'older', project: 'website', entered: 1789210000 })
    const newer = session({ id: 'newer', project: 'clawdeen', entered: 1789219000 })
    expect([newer, older].sort(inLane([], [])).map((one) => one.id)).toEqual(['older', 'newer'])
  })

  it('falls back to what moved last where no state stands behind the card', () => {
    const quiet = session({ id: 'quiet', activity: null, entered: null, last: 1789210000 })
    const recent = session({ id: 'recent', activity: null, entered: null, last: 1789219000 })
    expect([quiet, recent].sort(inLane([])).map((one) => one.id)).toEqual(['recent', 'quiet'])
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
    expect(repoColour('clawdeen')).toBe(repoColour('clawdeen'))
  })

  it('tells the repositories on this machine apart', () => {
    const names = ['clawdeen', 'notes', 'website']
    expect(new Set(names.map(repoColour)).size).toBe(names.length)
  })

  it('answers with a colour even for a name that says nothing', () => {
    expect(repoColour('')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
