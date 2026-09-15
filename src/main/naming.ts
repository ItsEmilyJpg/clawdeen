import { glob, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { everySaying, say } from '../shared/i18n'
import { SESSIONS } from './paths'

/** What stands between the mark and the name the session had, in the app's sidebar. */
const JOIN = ' - '

/**
 * Every mark a parked session's name can start with. Read off the phrases rather than typed here,
 * so a language is stripped back off because it exists, not because somebody remembered it.
 */
function marks(): string[] {
  return [...new Set(everySaying('heldMark'))]
}

/**
 * The same word without its accents, because a name marked by hand in the Claude app is written
 * `ODLOZENO` as often as `ODLOŽENO` and a mark that is not recognised is a mark that gets doubled.
 */
function bald(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/**
 * The name a session should carry, given whether it is parked.
 *
 * Idempotent in both directions: a mark is never stacked on a name that already carries one, and a
 * name that carries a mark in the other language is stripped of it before this one goes on. The
 * mark is separated by `JOIN` and nothing else, so what is put on can be taken off exactly.
 */
export function markTitle(title: string, on: boolean): string {
  const every = marks().map((one) => bald(one + JOIN))
  let bare = title
  for (;;) {
    const mark = every.find((one) => bald(bare).startsWith(one))
    if (!mark) break
    bare = bare.slice(mark.length)
  }
  if (!on) return bare
  return `${say('heldMark')}${JOIN}${bare}`
}

/** The record the Claude app keeps for one session, or null where no file names it. */
async function recordFile(id: string): Promise<string | null> {
  for await (const path of glob(join(SESSIONS, '*', '*', '*.json'))) {
    try {
      const record = JSON.parse(await readFile(path, 'utf8')) as { sessionId?: unknown }
      if (record.sessionId === id) return path
    } catch {
      // A record nobody can parse is not the one being looked for either.
    }
  }
  return null
}

/**
 * Say in the Claude app itself that a session is parked, by putting the mark on its name.
 *
 * This is the one place the board writes into somebody else's store, and it writes the record back
 * whole: every field is kept and only `title` moves, so a version of the app that keeps fields this
 * one has never heard of loses none of them. A failure is a warning and nothing more, because the
 * board's own parking has already happened and must not be undone by a file that would not open.
 *
 * What it does not do is reach the sidebar of a running app. Measured rather than assumed: a record
 * marked here read back unmarked through the app's own session interface, and the app wrote its own
 * title over the file within ninety seconds, off the copy it keeps in memory. So the mark holds on
 * disk for a session the app is not writing, and shows in the list when the app is next started.
 */
export async function renameHeld(id: string, on: boolean): Promise<void> {
  const path = await recordFile(id)
  if (!path) return
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as { title?: unknown }
    if (typeof record.title !== 'string') return
    const next = markTitle(record.title, on)
    if (next === record.title) return
    await writeFile(path, JSON.stringify({ ...record, title: next }))
  } catch (error) {
    console.warn(`naming: ${(error as Error).message}`)
  }
}
