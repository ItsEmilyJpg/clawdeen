// Measurement of overlapping board() runs, and nothing else. Silent unless CLAWDEEN_TRACE names a
// file, and meant to come out again once the coalescing it measures for is decided.
import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync } from 'node:fs'

const FILE = process.env['CLAWDEEN_TRACE'] ?? ''
const started = Date.now()
export const run = new AsyncLocalStorage<number>()

export function trace(line: string): void {
  if (!FILE) return
  const at = ((Date.now() - started) / 1000).toFixed(3)
  appendFileSync(FILE, `${at}\t${run.getStore() ?? '-'}\t${line}\n`)
}
