import { readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { glob } from 'node:fs/promises'

import { GATES } from './paths'
import type { SessionRecord } from './records'

/** The queue gives up after ten minutes, so an older unregistered lock is one a killed gate left. */
const STALE_LOCK = 900

export interface GateConfig {
  lock: string
  running: Set<string>
  /** What a check prints while it waits for its turn, which is how a queued one is known. */
  queueing: RegExp | null
}

/** Where a long local check registers itself, kept beside this repository rather than in it. */
export async function gates(): Promise<GateConfig | null> {
  let config: { registry?: string; lock?: string; queueing?: string }
  try {
    config = JSON.parse(await readFile(GATES, 'utf8')) as {
      registry?: string
      lock?: string
      queueing?: string
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`${GATES}: ${(error as Error).name}`)
    return null
  }
  const registry = (config.registry ?? '').replace(
    /\$\{(\w+)\}/g,
    (whole, name: string) => process.env[name] ?? whole
  )
  const running = new Set<string>()
  if (registry) {
    for await (const entry of glob(join(registry, '*'))) {
      try {
        running.add(await realpath((await readFile(entry, 'utf8')).trim()))
      } catch {
        // A gate that ended between the listing and the read; the next pass will not see it either.
      }
    }
  }
  let queueing: RegExp | null = null
  if (config.queueing) {
    try {
      queueing = new RegExp(config.queueing)
    } catch (error) {
      console.warn(`${GATES}: queueing is not a pattern, ${(error as Error).message}`)
    }
  }
  return { lock: config.lock ?? '', running, queueing }
}

/**
 * The lock is taken before the wait for a free slot and the registry only after it, so the two
 * together say which of the two a finished turn is waiting on.
 */
export async function gateState(
  record: SessionRecord,
  config: GateConfig | null
): Promise<'gate běží' | 'gate ve frontě' | null> {
  const tree = record.worktreePath ?? record.cwd
  if (!config || !tree || !config.lock) return null
  const lock = join(tree, config.lock)
  let taken: Awaited<ReturnType<typeof stat>>
  try {
    taken = await stat(lock)
  } catch {
    return null
  }
  if (!taken.isDirectory()) return null
  if (config.running.has(await realpath(tree).catch(() => tree))) return 'gate běží'
  return Date.now() / 1000 - taken.mtimeMs / 1000 < STALE_LOCK ? 'gate ve frontě' : null
}
