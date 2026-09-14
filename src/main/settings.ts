import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { localeOf, type Locale } from '../shared/i18n'

/** What the board remembers between runs. Beside `window.json`, which keeps where the window was. */
export interface Settings {
  locale: Locale
  /**
   * The repositories the board does not draw. What is hidden rather than what is shown, so a
   * repository opened for the first time appears on its own rather than waiting to be allowed.
   */
  hidden: string[]
  /**
   * The repositories in the order she dragged them into in the settings. Only the ones she has
   * moved: a name missing here has never been arranged and sorts after those that have.
   */
  projectOrder: string[]
  /**
   * The sessions she has parked, by session id. Kept here and not read off anything Claude writes,
   * because Claude knows nothing about it: the star on a session is its own thing and means pinned.
   */
  held: string[]
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** The language of the Mac the first time the board is opened, and the chosen one ever after. */
export function settings(): Settings {
  try {
    const kept = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    // A file written by a newer version could say anything; only a language this one knows is taken.
    const hidden = Array.isArray(kept.hidden)
      ? kept.hidden.filter((one) => typeof one === 'string')
      : []
    const projectOrder = Array.isArray(kept.projectOrder)
      ? kept.projectOrder.filter((one) => typeof one === 'string')
      : []
    const held = Array.isArray(kept.held) ? kept.held.filter((one) => typeof one === 'string') : []
    if (kept.locale === 'en' || kept.locale === 'cs') {
      return { locale: kept.locale, hidden, projectOrder, held }
    }
    return { locale: localeOf(app.getLocale()), hidden, projectOrder, held }
  } catch {
    // No file yet, or one nobody can read. Either way the system is what to open in.
  }
  return { locale: localeOf(app.getLocale()), hidden: [], projectOrder: [], held: [] }
}

export function saveSettings(patch: Partial<Settings>): void {
  const next: Settings = { ...settings(), ...patch }
  try {
    writeFileSync(file(), JSON.stringify(next), { mode: 0o600 })
  } catch (error) {
    // A setting that could not be written is worth a line, never a dialog: the board still runs.
    console.warn(`settings: ${(error as Error).message}`)
  }
}
