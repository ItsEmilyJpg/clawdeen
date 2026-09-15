import { decimal, money, say, setLocale, stateWord, toolCount } from '../../shared/i18n'
import { byProject } from '../../shared/projects'
import type { ActivityWord, Change, Session, StateWord } from '../../shared/types'

export { decimal, money, say, setLocale, stateWord, toolCount }
export {
  ago,
  burnVerdict,
  clock,
  doubtsOf,
  inWords,
  refreshVerdict,
  repoColour,
  stateLabel
} from '../../shared/words'

/** The colour of a pull request is its own state: open, merged, closed or still a draft. */
export function prClass(change: Change, session: Session): string {
  if (change.state === 'merged') return 'pr-merged'
  if (!change.open) return 'pr-closed'
  if (change.draft) return 'pr-draft'
  const red =
    change === session.change && (session.state === 'ci-red' || session.state === 'conflict')
  return red ? 'pr-red' : 'pr-open'
}

/** One class per word, the same names the stylesheet colours. */
export const STATE_CLASS: { [key in StateWord]: string } = {
  working: 's-working',
  'gate-running': 's-gate',
  'gate-queued': 's-queued',
  'task-running': 's-task',
  'task-queued': 's-queued',
  'waiting-for-you': 's-waiting',
  'waiting-for-ci': 's-running',
  'waiting-for-issue': 's-queued',
  'waiting-for-other': 's-queued',
  'on-hold': 's-hold',
  'no-pr': 's-none',
  draft: 's-draft',
  conflict: 's-conflict',
  'ci-running': 's-running',
  'ci-red': 's-failing',
  'changes-requested': 's-changes',
  mergeable: 's-mergeable',
  'in-review': 's-review',
  open: 's-review',
  merged: 's-merged',
  closed: 's-closed'
}

/** The order the filter bar counts them in: what a session is doing first, where its change stands after. */
export const STATE_ORDER = Object.keys(STATE_CLASS) as StateWord[]

/**
 * The workflow: what a session goes through, in the order it is worth looking at.
 *
 * The titles are read rather than stored, because a lane is named after its state and the language
 * can change under a running window.
 */
export const LANE_WORDS: (ActivityWord | null)[] = [
  'waiting-for-you',
  'working',
  'task-running',
  'task-queued',
  'gate-running',
  'gate-queued',
  // Last of the lanes that say something: a wait on somebody else's machine is nobody's to answer,
  // and it belongs under everything that is still hers.
  'waiting-for-ci',
  'waiting-for-issue',
  'waiting-for-other',
  null,
  // The bottom of the board, under the lane that takes the leftovers: a wait still ends on its own
  // and this one ends when she says so, so it is the one thing on the board she is not waiting for.
  // It keeps a lane rather than leaving: parked is not gone, which is the whole point of it.
  'on-hold'
]

export function laneRows(): { word: ActivityWord | null; title: string }[] {
  return LANE_WORDS.map((word) => ({
    word,
    title: word === null ? say('otherLane') : stateWord(word)
  }))
}

/**
 * A lane holds still. The list sorts by what moved last, which is right there and wrong here: a
 * card that jumps up because its session typed one more line is a card she has to find again. What
 * she dragged and what she pinned still comes first, and after them the repositories in the order
 * she put them in the settings; the rest stands by how long it has been in the state the lane is
 * named after, longest first, which only moves when the state itself does.
 * The last lane has no state under it, so it falls back to what moved last: a session doing
 * nothing does not move either.
 */
export function inLane(
  order: string[],
  projects: string[] = []
): (one: Session, other: Session) => number {
  const placed = (session: Session): number => {
    const at = order.indexOf(session.id)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  const repo = byProject(projects)
  return (one, other) =>
    placed(one) - placed(other) ||
    Number(!one.pinned) - Number(!other.pinned) ||
    repo(one.project, other.project) ||
    (one.entered ?? Number.MAX_SAFE_INTEGER) - (other.entered ?? Number.MAX_SAFE_INTEGER) ||
    other.last - one.last
}
