import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chat } from '../src/main/chat'

const rubbish: string[] = []

afterEach(() => {
  for (const path of rubbish.splice(0)) rmSync(path, { recursive: true, force: true })
})

function transcript(lines: unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'board-chat-'))
  rubbish.push(directory)
  const path = join(directory, 'session.jsonl')
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return path
}

const called = (name: string, input: unknown): unknown => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] }
})

describe('chat names what a tool call was on', () => {
  it('takes the command from a shell call and the path from a file one', async () => {
    const path = transcript([
      called('Bash', { command: 'make check', description: 'Run the gate' }),
      called('Read', { file_path: '/one/two.ts', limit: 20 })
    ])
    const [line] = await chat(path)
    expect(line.tools).toEqual([
      { name: 'Bash', about: 'make check' },
      { name: 'Read', about: '/one/two.ts' }
    ])
  })

  it('says only the first line of a command that runs over several', async () => {
    const path = transcript([called('Bash', { command: 'cd /one &&\\\nmake check' })])
    const [line] = await chat(path)
    expect(line.tools[0].about).toBe('cd /one &&\\')
  })

  it('leaves the call unnamed rather than guessing when no argument says what it was on', async () => {
    const path = transcript([called('TaskOutput', { task_id: 'abc123', block: true })])
    const [line] = await chat(path)
    expect(line.tools).toEqual([{ name: 'TaskOutput', about: '' }])
  })

  it('carries nothing of what a tool answered', async () => {
    const path = transcript([
      called('Bash', { command: 'cat a-secret' }),
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', text: 'hunter2' }] }
      }
    ])
    const found = await chat(path)
    expect(JSON.stringify(found)).not.toContain('hunter2')
  })
})
