#!/usr/bin/env node
// Puts the board's hook into the Claude settings, and takes it out again with --remove.
//
// The script itself is copied next to the other configuration rather than run from the checkout:
// the settings should not break when this repository is moved or a branch is checked out.
import { copyFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const INSTALLED = join(homedir(), '.config', 'claude-sessions', 'board-event.sh')
const SOURCE = join(import.meta.dirname, 'board-event.sh')
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop']

const removing = process.argv.includes('--remove')

async function settings() {
  try {
    return JSON.parse(await readFile(SETTINGS, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

const kept = await settings()
// A settings file is hers, and a bad write would lose every other hook in it.
await writeFile(`${SETTINGS}.before-board`, JSON.stringify(kept, null, 2) + '\n')

kept.hooks ??= {}
let touched = 0

for (const event of EVENTS) {
  const groups = (kept.hooks[event] ??= [])
  const mine = (group) =>
    (group.hooks ?? []).some((hook) => (hook.command ?? '').includes('board-event.sh'))
  const already = groups.some(mine)

  if (removing) {
    kept.hooks[event] = groups.filter((group) => !mine(group))
    if (kept.hooks[event].length === 0) delete kept.hooks[event]
    touched += already ? 1 : 0
    continue
  }
  if (already) continue
  groups.push({ hooks: [{ type: 'command', command: INSTALLED, timeout: 5 }] })
  touched += 1
}

if (!removing) {
  await mkdir(dirname(INSTALLED), { recursive: true })
  await copyFile(SOURCE, INSTALLED)
  await chmod(INSTALLED, 0o755)
}

await writeFile(SETTINGS, JSON.stringify(kept, null, 2) + '\n')
console.log(
  removing
    ? `taken out of ${touched} events; the copy at ${INSTALLED} is left where it is`
    : `installed for ${touched} of ${EVENTS.length} events (the rest already had it)`
)
console.log(`what was there before: ${SETTINGS}.before-board`)
