import type { Session } from './types'

/**
 * Which repositories the window draws, and what it is not drawing.
 *
 * The filtering lives here and only here, in the renderer's half of the world. The main process
 * hands over every session it found: the tray counts them, the notifications ring for them, and the
 * history records them, all of it without asking what is hidden. A hidden repository is out of
 * sight, never out of mind, and that is the whole reason this is safe to have at all.
 */

/** The sessions the window draws: everything whose repository has not been switched off. */
export function visible(sessions: Session[], hidden: string[]): Session[] {
  if (hidden.length === 0) return sessions
  const off = new Set(hidden)
  return sessions.filter((session) => !off.has(session.project))
}

/**
 * What is behind the filter, so the window can say so rather than leave a gap.
 *
 * The waiting count is the part that matters: a session nobody can see is one thing, a session
 * waiting for an answer that nobody can see is the failure this whole feature has to avoid.
 */
export function hiddenTally(
  sessions: Session[],
  hidden: string[]
): { count: number; waiting: number } {
  if (hidden.length === 0) return { count: 0, waiting: 0 }
  const off = new Set(hidden)
  const away = sessions.filter((session) => off.has(session.project))
  return {
    count: away.length,
    waiting: away.filter((session) => session.activity === 'waiting-for-you').length
  }
}

/**
 * The repositories in the order she dragged them into, with the rest behind them as they came.
 *
 * A name she has never moved has no place in the stored order, and guessing one would move a
 * repository she never touched. So it keeps the alphabetical order it arrived in, after everything
 * she did arrange, and the first drag is what puts it anywhere else.
 */
export function ordered(projects: string[], order: string[]): string[] {
  if (order.length === 0) return projects
  const at = new Map(order.map((name, index) => [name, index]))
  return [...projects].sort(
    (one, other) =>
      (at.get(one) ?? Number.MAX_SAFE_INTEGER) - (at.get(other) ?? Number.MAX_SAFE_INTEGER)
  )
}

/** Dropping one repository onto another, as the whole order the settings then keep. */
export function movedProject(projects: string[], held: string, onto: string): string[] {
  const names = [...projects]
  const from = names.indexOf(held)
  const to = names.indexOf(onto)
  if (from === -1 || to === -1 || from === to) return projects
  names.splice(to, 0, ...names.splice(from, 1))
  return names
}

/**
 * Where a session's repository sits in that order, for sorting cards by it.
 *
 * Nothing arranged means nothing to say: the comparator is flat until she has dragged a repository,
 * so a board nobody has touched sorts exactly as it did before this existed.
 */
export function byProject(order: string[]): (one: string, other: string) => number {
  if (order.length === 0) return () => 0
  const at = new Map(order.map((name, index) => [name, index]))
  return (one, other) =>
    (at.get(one) ?? Number.MAX_SAFE_INTEGER) - (at.get(other) ?? Number.MAX_SAFE_INTEGER)
}

/** Switching one repository off, or back on, as the stored list of hidden ones. */
export function withProject(hidden: string[], project: string, shown: boolean): string[] {
  const off = new Set(hidden)
  if (shown) off.delete(project)
  else off.add(project)
  return [...off].sort()
}
