import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

import { lastTurn, pendingWork, touchedPaths, watchedFor } from '../src/main/transcripts'

const rubbish: string[] = []

afterEach(() => {
  for (const path of rubbish.splice(0)) rmSync(path, { recursive: true, force: true })
})

function transcript(lines: unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'board-transcript-'))
  rubbish.push(directory)
  const path = join(directory, 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return path
}

/** A session the task directory knows about, which is what lets pendingWork read the transcript at all. */
function withTasks(
  cli: string,
  task = 'one',
  quietFor = 0,
  wrote = 'the task said something\n'
): void {
  const directory = join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`, cli, 'tasks')
  mkdirSync(directory, { recursive: true })
  const output = join(directory, `${task}.output`)
  writeFileSync(output, wrote)
  if (quietFor > 0) {
    const when = new Date(Date.now() - quietFor * 1000)
    utimesSync(output, when, when)
  }
  rubbish.push(join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`))
}

/** A task directory with nothing in it, which is what a session whose monitor is quiet has. */
function withoutTasks(cli: string): void {
  mkdirSync(join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`, cli, 'tasks'), {
    recursive: true
  })
  rubbish.push(join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`))
}

/** The line the harness prints when a command goes to the background, path and all. */
const backgrounded = (cli: string, task: string): string =>
  `Command running in background with ID: ${task}. Output is being written to: ` +
  `/tmp/claude-${userInfo().uid}/board-test-${cli}/${cli}/tasks/${task}.output`

const said = (role: string, content: unknown, stop?: string): unknown => ({
  type: role,
  message: { role, content, stop_reason: stop }
})

/** The call that puts a command in the background, and the result that gives it its task id. */
const ranInBackground = (command: string, id: string): unknown =>
  said('assistant', [{ type: 'tool_use', name: 'Bash', id, input: { command } }], 'tool_use')

const resultOf = (id: string, content: string): unknown =>
  said('user', [{ type: 'tool_result', tool_use_id: id, content }])

/** A monitor, which the session starts the same way and which exists to wait. */
const watched = (command: string, id: string): unknown =>
  said('assistant', [{ type: 'tool_use', name: 'Monitor', id, input: { command } }], 'tool_use')

describe('lastTurn', () => {
  it('is asking while a question stands unanswered', async () => {
    const path = transcript([
      said('user', [{ type: 'text', text: 'jeď' }]),
      said('assistant', [{ type: 'tool_use', name: 'AskUserQuestion' }], 'tool_use')
    ])
    await expect(lastTurn(path)).resolves.toBe('asking')
  })

  it('is running while a tool is out', async () => {
    const path = transcript([said('assistant', [{ type: 'tool_use', name: 'Bash' }], 'tool_use')])
    await expect(lastTurn(path)).resolves.toBe('running')
  })

  it('has ended when the answer stopped for anything else', async () => {
    const path = transcript([said('assistant', [{ type: 'text', text: 'hotovo' }], 'end_turn')])
    await expect(lastTurn(path)).resolves.toBe('ended')
  })

  it('reads the main thread and not an agent of its own', async () => {
    const path = transcript([
      said('assistant', [{ type: 'text', text: 'hotovo' }], 'end_turn'),
      {
        ...(said('assistant', [{ type: 'tool_use', name: 'Bash' }], 'tool_use') as object),
        isSidechain: true
      }
    ])
    await expect(lastTurn(path)).resolves.toBe('ended')
  })
})

describe('pendingWork', () => {
  it('is nothing without a task directory of its own', async () => {
    const path = transcript([said('user', backgrounded('unknown-session', 'babc12345'))])
    expect(await pendingWork('unknown-session', path)).toBeNull()
  })

  it('lets go of a task whose own output ends with the harness killing it', async () => {
    withTasks('over-killed', 'bkil12345', 0, 'make check\n\n[killed]\n')
    const path = transcript([said('user', backgrounded('over-killed', 'bkil12345'))])
    expect(await pendingWork('over-killed', path)).toBeNull()
  })

  it('lets go of one that ended with a code, notification or not', async () => {
    withTasks('over-exited', 'bexi12345', 0, 'Time: 45m 29s.\n\n[exited with code 0]\n')
    const path = transcript([said('user', backgrounded('over-exited', 'bexi12345'))])
    expect(await pendingWork('over-exited', path)).toBeNull()
  })

  it('holds a task that only carries the word somewhere in the middle', async () => {
    withTasks('still-going', 'bkil54321', 0, '[killed]\nand then it kept going\n')
    const path = transcript([said('user', backgrounded('still-going', 'bkil54321'))])
    expect((await pendingWork('still-going', path))?.doing).toBe('working')
  })

  it('holds one whose last line is a bracket of the command’s own making', async () => {
    withTasks('still-talking', 'bbra12345', 0, "config for ['doctrine.middleware']\n")
    const path = transcript([said('user', backgrounded('still-talking', 'bbra12345'))])
    expect((await pendingWork('still-talking', path))?.doing).toBe('working')
  })

  it('holds a task that started and never reported back', async () => {
    withTasks('one', 'babc12345')
    const path = transcript([said('user', backgrounded('one', 'babc12345'))])
    expect((await pendingWork('one', path))?.doing).toBe('working')
  })

  it('lets go once the notification arrives', async () => {
    withTasks('two', 'babc12345')
    const path = transcript([
      said('user', backgrounded('two', 'babc12345')),
      said(
        'user',
        '<task-notification>\n<task-id>babc12345</task-id>\n<status>completed</status>\n</task-notification>'
      )
    ])
    expect(await pendingWork('two', path)).toBeNull()
  })

  /**
   * The sweep reads only what was appended, so a notification that falls across two reads is the
   * one way a session could stay busy for ever.
   */
  it('sees a notification split across two reads', async () => {
    withTasks('three', 'babc12345')
    const path = transcript([said('user', backgrounded('three', 'babc12345'))])
    expect((await pendingWork('three', path))?.doing).toBe('working')

    const notification = JSON.stringify(
      said(
        'user',
        '<task-notification>\n<task-id>babc12345</task-id>\n<status>completed</status>\n</task-notification>'
      )
    )
    const half = Math.floor(notification.length / 2)
    appendFileSync(path, notification.slice(0, half))
    expect((await pendingWork('three', path))?.doing).toBe('working')

    appendFileSync(path, notification.slice(half) + '\n')
    expect(await pendingWork('three', path)).toBeNull()
  })
})

describe('pendingWork tells waiting from working', () => {
  it('calls a monitor watching, because it waits on something outside the session', async () => {
    withTasks('four', 'bmon12345')
    const path = transcript([
      watched('while true; do sleep 60; done', 'toolu_mon'),
      resultOf('toolu_mon', 'Monitor started (task bmon12345, persistent')
    ])
    expect((await pendingWork('four', path))?.doing).toBe('watching')
  })

  /** A monitor has no output file until it has something to say, which is most of its life. */
  it('holds a monitor that has not written a file at all', async () => {
    withoutTasks('twelve')
    const path = transcript([
      watched('while true; do sleep 60; done', 'toolu_quiet'),
      resultOf('toolu_quiet', 'Monitor started (task bmon55555, persistent')
    ])
    expect((await pendingWork('twelve', path))?.doing).toBe('watching')
  })

  /** The same wording in a transcript the session only read names somebody else's task. */
  it('leaves alone a monitor the session merely quoted', async () => {
    withTasks('thirteen', 'bcmd66666')
    const path = transcript([
      said('assistant', [
        { type: 'text', text: 'the file says: Monitor started (task bmon66666,' }
      ]),
      said('user', backgrounded('thirteen', 'bcmd66666'))
    ])
    expect((await pendingWork('thirteen', path))?.doing).toBe('working')
  })

  it('calls a command that has just written working', async () => {
    withTasks('five', 'bcmd12345')
    const path = transcript([said('user', backgrounded('five', 'bcmd12345'))])
    expect((await pendingWork('five', path))?.doing).toBe('working')
  })

  it('calls a command that has gone quiet waiting', async () => {
    withTasks('six', 'bcmd67890', 20 * 60)
    const path = transcript([said('user', backgrounded('six', 'bcmd67890'))])
    expect((await pendingWork('six', path))?.doing).toBe('waiting')
  })

  /** An empty file stamps when it was made, which is not the task saying anything. */
  it('calls a command that has never printed a byte waiting', async () => {
    withTasks('eight', 'bcmd11111', 0, '')
    const path = transcript([said('user', backgrounded('eight', 'bcmd11111'))])
    expect((await pendingWork('eight', path))?.doing).toBe('waiting')
  })

  it('calls a loop that sleeps waiting, however loudly it prints', async () => {
    withTasks('nine', 'bcmd22222')
    const path = transcript([
      ranInBackground('until [ -e /tmp/free ]; do sleep 60; done', 'toolu_one'),
      resultOf('toolu_one', backgrounded('nine', 'bcmd22222'))
    ])
    expect((await pendingWork('nine', path))?.doing).toBe('waiting')
  })

  /** The call and its result land in different sweeps, and only the call carries the command. */
  it('holds the command across two reads, so a later result still says it was a wait', async () => {
    withTasks('ten', 'bcmd33333')
    const path = transcript([ranInBackground('while true; do sleep 30; done', 'toolu_two')])
    appendFileSync(
      path,
      JSON.stringify(resultOf('toolu_two', backgrounded('ten', 'bcmd33333'))) + '\n'
    )
    expect((await pendingWork('ten', path))?.doing).toBe('waiting')
  })

  it('leaves a command that only mentions sleep alone', async () => {
    withTasks('eleven', 'bcmd44444')
    const path = transcript([
      ranInBackground('make check  # the gate sleeps on nothing', 'toolu_three'),
      resultOf('toolu_three', backgrounded('eleven', 'bcmd44444'))
    ])
    expect((await pendingWork('eleven', path))?.doing).toBe('working')
  })
})

describe('lastTurn reads a turn in flight', () => {
  it('is running while a tool result is the last thing written', async () => {
    const path = transcript([
      said('assistant', [{ type: 'tool_use', name: 'Bash' }], 'tool_use'),
      said('user', [{ type: 'tool_result' }])
    ])
    await expect(lastTurn(path)).resolves.toBe('running')
  })

  it('is running while an answer to what she typed is still being written', async () => {
    const path = transcript([
      said('assistant', [{ type: 'text', text: 'hotovo' }], 'end_turn'),
      said('user', [{ type: 'text', text: 'a dál?' }])
    ])
    await expect(lastTurn(path)).resolves.toBe('running')
  })
})

describe('pendingWork lets go of a task that died', () => {
  it('ignores a task that went silent while the session kept talking', async () => {
    withTasks('seven', 'bold12345', 3 * 3600)
    const path = transcript([said('user', backgrounded('seven', 'bold12345'))])
    expect(await pendingWork('seven', path)).toBeNull()
  })
})

describe('watchedFor names what a monitor watches', () => {
  const monitor = (command: string): unknown => ({
    type: 'assistant',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'Monitor', input: { command } }]
    }
  })

  it('reads a run from the checks it asks about', async () => {
    const path = transcript([monitor('gh pr checks 858 --json state  # CI na PR #858')])
    expect(await watchedFor(path)).toEqual({ kind: 'ci', about: '#858' })
  })

  it('reads an issue from the call that asks for it', async () => {
    const path = transcript([monitor('gh issue view 835 --json state  # čeká na #835')])
    expect(await watchedFor(path)).toEqual({ kind: 'issue', about: '#835' })
  })

  it('says nothing about a watcher pointed at something else', async () => {
    const path = transcript([monitor('while true; do sleep 60; done')])
    expect(await watchedFor(path)).toEqual({ kind: 'other', about: null })
  })
})

describe('touchedPaths reads the directories a session names', () => {
  const ran = (command: string, over: Record<string, unknown> = {}): unknown => ({
    type: 'assistant',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'Bash', input: { command } }]
    },
    ...over
  })

  it('gives the newest first, from a cd and from a git -C alike', async () => {
    const path = transcript([
      ran('cd /one && git status'),
      ran('git -C /two log --oneline -3'),
      ran('cd /three && npm test')
    ])
    expect(await touchedPaths(path, '/opened')).toEqual(['/three', '/two', '/one'])
  })

  it('reads a directory a command names only once, at its newest', async () => {
    const path = transcript([ran('cd /one && ls'), ran('git -C /two status'), ran('cd /one && ls')])
    expect(await touchedPaths(path, '/opened')).toEqual(['/one', '/two'])
  })

  it('leaves alone a path the session only read, and one the shell computes', async () => {
    const path = transcript([
      said('user', 'the file says: git -C /Users/someone/elsewhere rev-parse'),
      ran('git -C "$ROOT" status'),
      ran('cd /named && ls')
    ])
    expect(await touchedPaths(path, '/opened')).toEqual(['/named'])
  })

  it('reads a relative path against the copy the session was opened in, and ~ against home', async () => {
    const path = transcript([ran('cd ~/dev/thing && ls'), ran('git -C .claude/worktrees/one diff')])
    expect(await touchedPaths(path, '/opened')).toEqual([
      '/opened/.claude/worktrees/one',
      join(homedir(), 'dev/thing')
    ])
  })

  it('leaves an agent of its own out of it, because it works somewhere else by design', async () => {
    const path = transcript([
      ran('cd /mine && ls'),
      ran('cd /the-agents && ls', { isSidechain: true })
    ])
    expect(await touchedPaths(path, '/opened')).toEqual(['/mine'])
  })

  it('reads what was appended since the last pass and keeps what it already had', async () => {
    const path = transcript([ran('cd /first && ls')])
    expect(await touchedPaths(path, '/opened')).toEqual(['/first'])
    appendFileSync(path, JSON.stringify(ran('git -C /second status')) + '\n')
    expect(await touchedPaths(path, '/opened')).toEqual(['/second', '/first'])
  })
})
