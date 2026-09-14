import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

const home = homedir()

/**
 * Where the configuration lives, under the name the application has now.
 *
 * An install from before it was called Clawdeen is left exactly where it is. The hook that writes
 * into that directory is a copy installed into the Claude settings, and whatever else reads it sits
 * outside this repository altogether, so moving the directory would break a working setup until
 * every one of those moved with it. A fresh install never creates the old name.
 */
function configDir(): string {
  const named = join(home, '.config/clawdeen')
  const before = join(home, '.config/claude-sessions')
  if (existsSync(named) || !existsSync(before)) return named
  return before
}

export const CONFIG = configDir()

/** Where the Claude desktop app keeps one JSON file per session, by account and organisation. */
export const SESSIONS = join(home, 'Library/Application Support/Claude/claude-code-sessions')
/** The sidebar lists one account, and this is what says which. */
export const APP_CONFIG = join(home, 'Library/Application Support/Claude/config.json')
/** The CLI transcripts, one JSONL per session, in a directory named after the working copy. */
export const TRANSCRIPTS = join(home, '.claude/projects')
/** Output of backgrounded commands, monitors and agents, one file per task. */
export const TASKS = join('/tmp', `claude-${userInfo().uid}`)
/** Work tracker hosts stay out of this repository, so the map lives beside it. */
export const JIRA_MAP = join(CONFIG, 'jira.json')
/** Where a long local check registers itself; absent, the gate states simply never appear. */
export const GATES = join(CONFIG, 'gates.json')
/** Where the board tells the hooks to reach it: the port it listens on and the token to use. */
export const LIVE = join(CONFIG, 'live.json')
/** The hook the application installs into the Claude settings, beside the rest of this. */
export const HOOK = join(CONFIG, 'board-event.sh')
/** Which account the CLI is logged into, which is whose the usage numbers are. */
export const CLI_CONFIG = join(home, '.claude.json')
