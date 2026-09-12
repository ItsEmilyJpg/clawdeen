import { describe, expect, it } from 'vitest'

import { claimCard, CLAIM_TTL, underClaim, type Claim } from '../src/main/focus'

/**
 * The app writes `lastFocusedAt` 1 to 3.5 seconds after the switch, so every reading here is the
 * records being late on purpose. `now` is passed rather than taken, so a test can sit inside that
 * gap or step out of it.
 */
function reading(
  held: Claim | null,
  open: string | null,
  now = 0
): { focus: string | null; held: Claim | null } {
  return underClaim(held, open, now)
}

describe('the claim while the records are late', () => {
  it('marks the card the board opened, not the one the records still name', () => {
    const held = claimCard(null, 'B', 'A', 0)
    expect(reading(held, 'A').focus).toBe('B')
  })

  it('holds through pass after pass of the same stale record', () => {
    let held = claimCard(null, 'B', 'A', 0)
    for (let pass = 0; pass < 5; pass++) {
      const read = reading(held, 'A', pass * 100)
      expect(read.focus).toBe('B')
      held = read.held
    }
  })

  it('lets go once the records name the card it claimed', () => {
    const held = claimCard(null, 'B', 'A', 0)
    const read = reading(held, 'B')
    expect(read.focus).toBe('B')
    expect(reading(read.held, 'C').focus).toBe('C')
  })

  it('lets the records win where they name a card the board never opened', () => {
    const held = claimCard(null, 'B', 'A', 0)
    const read = reading(held, 'C')
    expect(read.focus).toBe('C')
    expect(read.held).toBeNull()
  })

  it('lets go when the app never agrees at all', () => {
    const held = claimCard(null, 'B', 'A', 0)
    expect(reading(held, 'A', CLAIM_TTL + 1).focus).toBe('A')
  })
})

describe('a burst of clicks', () => {
  /**
   * The bug this was written for: the second claim used to be measured against the mark the first
   * one had just set, so the first reading of the records — still naming the card from before the
   * burst — looked like her opening something in the app, and the board fell back to it.
   */
  it('does not fall back to where the burst began', () => {
    let held = claimCard(null, 'B', 'A', 0)
    held = claimCard(held, 'C', 'A', 200)
    expect(reading(held, 'A', 300).focus).toBe('C')
  })

  it('stays on the last card while the records walk the ones before it', () => {
    let held = claimCard(null, 'B', 'A', 0)
    held = claimCard(held, 'C', 'A', 200)
    const seen: (string | null)[] = []
    for (const open of ['A', 'A', 'B', 'B', 'C']) {
      const read = reading(held, open, 400)
      seen.push(read.focus)
      held = read.held
    }
    expect(seen).toEqual(['C', 'C', 'C', 'C', 'C'])
  })

  it('still hands over to a card she opened in the app herself', () => {
    let held = claimCard(null, 'B', 'A', 0)
    held = claimCard(held, 'C', 'A', 200)
    expect(reading(held, 'D', 400).focus).toBe('D')
  })

  it('reads going back to a card the records have passed as her doing it', () => {
    let held = claimCard(null, 'B', 'A', 0)
    held = claimCard(held, 'C', 'A', 200)
    held = reading(held, 'B', 400).held
    expect(reading(held, 'A', 500).focus).toBe('A')
  })

  it('opens a fresh sequence once the old claim has timed out', () => {
    const stale = claimCard(null, 'B', 'A', 0)
    const held = claimCard(stale, 'C', 'B', CLAIM_TTL + 1)
    expect(held.ours).toEqual(['B', 'C'])
  })

  it('counts a click on the same card twice without losing the sequence', () => {
    let held = claimCard(null, 'B', 'A', 0)
    held = claimCard(held, 'B', 'A', 200)
    expect(reading(held, 'A', 300).focus).toBe('B')
  })
})

describe('with nothing open at all', () => {
  it('claims against an empty reading rather than against the board', () => {
    const held = claimCard(null, 'B', null, 0)
    expect(reading(held, null).focus).toBe('B')
  })
})
