import type { ActivityWord, Session, StateWord } from '../../shared/types'

export { ago, burnVerdict, clock, inWords, repoColour, stateLabel } from '../../shared/words'

/** One class per word, the same names the stylesheet colours. */
export const STATE_CLASS: { [key in StateWord]: string } = {
  pracuje: 's-working',
  'gate běží': 's-gate',
  'gate ve frontě': 's-queued',
  'úloha běží': 's-task',
  'úloha čeká': 's-queued',
  'čeká na tebe': 's-waiting',
  'čeká na CI': 's-running',
  'čeká na issue': 's-queued',
  'čeká na jiné': 's-queued',
  'bez PR': 's-none',
  koncept: 's-draft',
  konflikt: 's-conflict',
  'CI běží': 's-running',
  'CI červené': 's-failing',
  'změny žádané': 's-changes',
  'k mergi': 's-mergeable',
  'k review': 's-review',
  otevřené: 's-review',
  merged: 's-merged',
  zavřené: 's-closed'
}

/** The order the filter bar counts them in: what a session is doing first, where its change stands after. */
export const STATE_ORDER = Object.keys(STATE_CLASS) as StateWord[]

/** The workflow: what a session goes through, in the order it is worth looking at. */
export const LANES: { word: ActivityWord | null; title: string }[] = [
  { word: 'čeká na tebe', title: 'čeká na tebe' },
  { word: 'pracuje', title: 'pracuje' },
  { word: 'úloha běží', title: 'úloha běží' },
  { word: 'úloha čeká', title: 'úloha čeká' },
  { word: 'gate běží', title: 'gate běží' },
  { word: 'gate ve frontě', title: 'gate ve frontě' },
  // Last of the lanes that say something: a wait on somebody else's machine is nobody's to answer,
  // and it belongs under everything that is still hers.
  { word: 'čeká na CI', title: 'čeká na CI' },
  { word: 'čeká na issue', title: 'čeká na issue' },
  { word: 'čeká na jiné', title: 'čeká na jiné' },
  { word: null, title: 'ostatní' }
]

/**
 * A lane holds still. The list sorts by what moved last, which is right there and wrong here: a
 * card that jumps up because its session typed one more line is a card she has to find again. What
 * she dragged and what she pinned still comes first; the rest stands by how long it has been in
 * the state the lane is named after, longest first, which only moves when the state itself does.
 * The last lane has no state under it, so it falls back to what moved last: a session doing
 * nothing does not move either.
 */
export function inLane(order: string[]): (one: Session, other: Session) => number {
  const placed = (session: Session): number => {
    const at = order.indexOf(session.id)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  return (one, other) =>
    placed(one) - placed(other) ||
    Number(!one.pinned) - Number(!other.pinned) ||
    (one.entered ?? Number.MAX_SAFE_INTEGER) - (other.entered ?? Number.MAX_SAFE_INTEGER) ||
    other.last - one.last
}
