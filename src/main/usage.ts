import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import type { UsageWindow } from '../shared/types'
import { burnOf } from '../shared/words'
import { USAGE, USAGE_REFRESH } from './paths'

const run = promisify(execFile)

const TTL = 900
const STALE = 3600
const WINDOWS: [string, string, string][] = [
  ['five_hour', '5 hodin', '5 h'],
  ['seven_day', '7 dní', '7 d']
]

interface Stored {
  captured_at?: number
  [key: string]:
    { used_percentage?: number; resets_at?: number; duration_minutes?: number } | number | undefined
}

async function stored(): Promise<Stored> {
  try {
    return JSON.parse(await readFile(USAGE, 'utf8')) as Stored
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`${USAGE}: ${(error as Error).name}`)
    return {}
  }
}

export async function usage(now: number): Promise<UsageWindow[]> {
  let data = await stored()
  // Written by the terminal statusline, so a day spent in the app alone leaves it standing still.
  if (now - (data.captured_at ?? 0) > TTL) {
    try {
      await run('python3', [USAGE_REFRESH], { timeout: 20_000 })
      data = await stored()
    } catch (error) {
      console.warn(`${USAGE_REFRESH}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  const windows: UsageWindow[] = []
  for (const [key, label, short] of WINDOWS) {
    const window = data[key]
    if (typeof window !== 'object' || !window) continue
    const { used_percentage: used, resets_at: resets, duration_minutes: minutes } = window
    if (used === undefined || !resets || !minutes) continue
    // Spent against the share of the window that is gone: above one is faster than it refills.
    const gone = Math.min(1, Math.max(0, 1 - (resets - now) / (minutes * 60)))
    const left = Math.max(0, resets - now)
    const age = now - (data.captured_at ?? 0)
    windows.push({
      key,
      label,
      short,
      used,
      resets,
      left,
      pace: gone > 0.05 ? used / (gone * 100) : null,
      burn: burnOf(used, left, minutes),
      stale: age > STALE ? age : null
    })
  }
  return windows
}
