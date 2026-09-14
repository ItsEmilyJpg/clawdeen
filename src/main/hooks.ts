import { app } from 'electron'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import script from '../../resources/board-event.sh?asset'
import { HOOK } from './paths'

/**
 * Putting the hook into the Claude settings from inside the application, because whoever downloads
 * a build has no checkout to run a script from. The copy lives beside the other configuration, so
 * moving or deleting the application does not leave a hook pointing into nothing.
 */
const SETTINGS = join(app.getPath('home'), '.claude', 'settings.json')
const INSTALLED = HOOK
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop']

interface Hook {
  type?: string
  command?: string
  timeout?: number
}

interface Group {
  matcher?: string
  hooks?: Hook[]
}

interface Settings {
  hooks?: { [event: string]: Group[] }
  [key: string]: unknown
}

async function settings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(SETTINGS, 'utf8')) as Settings
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const ours = (group: Group): boolean =>
  (group.hooks ?? []).some((hook) => (hook.command ?? '').includes('board-event.sh'))

export async function hooksInstalled(): Promise<boolean> {
  const kept = await settings()
  return EVENTS.every((event) => (kept.hooks?.[event] ?? []).some(ours))
}

export async function installHooks(): Promise<string> {
  const kept = await settings()
  // Her settings file is hers, and a bad write would lose every other hook in it.
  await writeFile(`${SETTINGS}.before-board`, JSON.stringify(kept, null, 2) + '\n')
  kept.hooks ??= {}
  for (const event of EVENTS) {
    const groups = (kept.hooks[event] ??= [])
    if (groups.some(ours)) continue
    const group: Group = { hooks: [{ type: 'command', command: INSTALLED, timeout: 5 }] }
    // PreToolUse and PostToolUse are matched against the tool name; the rest take no matcher at all.
    if (event.endsWith('ToolUse')) group.matcher = '*'
    groups.push(group)
  }
  await mkdir(dirname(INSTALLED), { recursive: true })
  await copyFile(script, INSTALLED)
  await chmod(INSTALLED, 0o755)
  await writeFile(SETTINGS, JSON.stringify(kept, null, 2) + '\n')
  return `${SETTINGS}.before-board`
}

export async function removeHooks(): Promise<void> {
  const kept = await settings()
  for (const event of EVENTS) {
    const groups = kept.hooks?.[event]
    if (!groups) continue
    const left = groups.filter((group) => !ours(group))
    if (left.length > 0) kept.hooks![event] = left
    else delete kept.hooks![event]
  }
  await writeFile(SETTINGS, JSON.stringify(kept, null, 2) + '\n')
}
