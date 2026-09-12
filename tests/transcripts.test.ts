import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'

import { lastTurn, pendingWork } from '../src/main/transcripts'

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
function withTasks(cli: string, task = 'one', quietFor = 0): void {
  const directory = join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`, cli, 'tasks')
  mkdirSync(directory, { recursive: true })
  const output = join(directory, `${task}.output`)
  writeFileSync(output, '')
  if (quietFor > 0) {
    const when = new Date(Date.now() - quietFor * 1000)
    utimesSync(output, when, when)
  }
  rubbish.push(join('/tmp', `claude-${userInfo().uid}`, `board-test-${cli}`))
}

const said = (role: string, content: unknown, stop?: string): unknown => ({
  type: role,
  message: { role, content, stop_reason: stop }
})

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
    const path = transcript([said('user', 'Command running in background with ID: babc12345')])
    expect(await pendingWork('unknown-session', path)).toBeNull()
  })

  it('holds a task that started and never reported back', async () => {
    withTasks('one', 'babc12345')
    const path = transcript([said('user', 'Command running in background with ID: babc12345')])
    expect(await pendingWork('one', path)).toBe('working')
  })

  it('lets go once the notification arrives', async () => {
    withTasks('two', 'babc12345')
    const path = transcript([
      said('user', 'Command running in background with ID: babc12345'),
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
    const path = transcript([said('user', 'Command running in background with ID: babc12345')])
    expect(await pendingWork('three', path)).toBe('working')

    const notification = JSON.stringify(
      said(
        'user',
        '<task-notification>\n<task-id>babc12345</task-id>\n<status>completed</status>\n</task-notification>'
      )
    )
    const half = Math.floor(notification.length / 2)
    appendFileSync(path, notification.slice(0, half))
    expect(await pendingWork('three', path)).toBe('working')

    appendFileSync(path, notification.slice(half) + '\n')
    expect(await pendingWork('three', path)).toBeNull()
  })
})

describe('pendingWork tells waiting from working', () => {
  it('calls a monitor watching, because it waits on something outside the session', async () => {
    withTasks('four', 'bmon12345')
    const path = transcript([said('user', 'Monitor started (task bmon12345, persistent')])
    expect(await pendingWork('four', path)).toBe('watching')
  })

  it('calls a command that has just written working', async () => {
    withTasks('five', 'bcmd12345')
    const path = transcript([said('user', 'Command running in background with ID: bcmd12345')])
    expect(await pendingWork('five', path)).toBe('working')
  })

  it('calls a command that has gone quiet waiting', async () => {
    withTasks('six', 'bcmd67890', 20 * 60)
    const path = transcript([said('user', 'Command running in background with ID: bcmd67890')])
    expect(await pendingWork('six', path)).toBe('waiting')
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
    const path = transcript([said('user', 'Command running in background with ID: bold12345')])
    expect(await pendingWork('seven', path)).toBeNull()
  })
})
