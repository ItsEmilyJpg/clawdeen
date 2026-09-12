/**
 * Which card the board says is open in the app while the app has not said so itself yet. It stamps
 * `lastFocusedAt` on the switch but writes the record 1 to 3.5 seconds later, so in between the
 * records still name the card she has left, and every pass in that gap would put the mark back on
 * it. The claim is what the board holds against them until they catch up.
 */

/** How long the board's own claim outranks the records. Past this the app is simply not agreeing. */
export const CLAIM_TTL = 8000

export interface Claim {
  /** The card the board opened last, and the one it marks. */
  id: string
  /** When that happened, so a claim the app never agrees with lets go on its own. */
  at: number
  /**
   * Where the records stood when the burst began, and then every card the board has opened since,
   * in order. They walk this list late and one card at a time, so a step along it is the app
   * catching up; a step off it is her opening something over there herself.
   */
  ours: (string | null)[]
}

/**
 * The board opens a card. A second click carries the sequence on rather than starting a claim
 * against the mark the first click has just set: measured, clicking quickly between cards had the
 * second claim born already broken, because the records still named the card from before the first
 * click, which the new claim no longer expected. The board then fell back through every card the
 * records were still catching up on, which is the flicker.
 */
export function claimCard(
  held: Claim | null,
  id: string,
  recorded: string | null,
  now: number
): Claim {
  const burst = held && now - held.at <= CLAIM_TTL ? held.ours : [recorded]
  return { id, at: now, ours: [...burst, id] }
}

/**
 * Which card is marked, given what the records now say. The claim holds while they stand where the
 * burst began or on one of the cards the board opened; the moment they name anything else, she has
 * opened that one in the app herself and they win, because a board insisting on a card she has left
 * is worse than one that is late.
 */
export function underClaim(
  held: Claim | null,
  open: string | null,
  now: number
): { focus: string | null; held: Claim | null } {
  if (!held || now - held.at > CLAIM_TTL) return { focus: open, held: null }
  // Standing still is the usual answer, and it must not eat a step: the same stale record is read
  // again by every pass until the app writes, and once more by the full board already under way.
  if (open === held.ours[0]) return { focus: held.id, held }
  const at = held.ours.indexOf(open)
  if (at === -1) return { focus: open, held: null }
  // What they have walked past cannot come round again, so if it does, it is her going back to it.
  return { focus: held.id, held: { ...held, ours: held.ours.slice(at) } }
}
