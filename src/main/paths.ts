import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

const home = homedir()

/** Where the Claude desktop app keeps one JSON file per session, by account and organisation. */
export const SESSIONS = join(home, 'Library/Application Support/Claude/claude-code-sessions')
/** The sidebar lists one account, and this is what says which. */
export const APP_CONFIG = join(home, 'Library/Application Support/Claude/config.json')
/** The CLI transcripts, one JSONL per session, in a directory named after the working copy. */
export const TRANSCRIPTS = join(home, '.claude/projects')
/** Output of backgrounded commands, monitors and agents, one file per task. */
export const TASKS = join('/tmp', `claude-${userInfo().uid}`)
/** Work tracker hosts stay out of this repository, so the map lives beside it. */
export const JIRA_MAP = join(home, '.config/claude-sessions/jira.json')
/** Where a long local check registers itself; absent, the gate states simply never appear. */
export const GATES = join(home, '.config/claude-sessions/gates.json')
/** Written by the terminal statusline, refreshed by the script below it. */
export const USAGE = join(home, '.cache/terminal-welcome/claude-usage.json')
export const USAGE_REFRESH = join(home, '.config/bash/ai-usage.py')
