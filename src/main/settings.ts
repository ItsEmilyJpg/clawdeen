import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { localeOf, type Locale } from '../shared/i18n'

/** What the board remembers between runs. Beside `window.json`, which keeps where the window was. */
export interface Settings {
  locale: Locale
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** The language of the Mac the first time the board is opened, and the chosen one ever after. */
export function settings(): Settings {
  try {
    const kept = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>
    // A file written by a newer version could say anything; only a language this one knows is taken.
    if (kept.locale === 'en' || kept.locale === 'cs') return { locale: kept.locale }
  } catch {
    // No file yet, or one nobody can read. Either way the system is what to open in.
  }
  return { locale: localeOf(app.getLocale()) }
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
