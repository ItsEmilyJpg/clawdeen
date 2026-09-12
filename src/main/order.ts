import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The order she dragged the cards into, kept beside the application's own data. */
function file(): string {
  return join(app.getPath('userData'), 'order.json')
}

export async function order(): Promise<string[]> {
  try {
    const stored = JSON.parse(await readFile(file(), 'utf8')) as { ids?: unknown }
    return Array.isArray(stored.ids)
      ? stored.ids.filter((id): id is string => typeof id === 'string')
      : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`order: ${(error as Error).name}`)
    return []
  }
}

export async function keepOrder(ids: string[]): Promise<void> {
  try {
    await writeFile(file(), JSON.stringify({ ids }))
  } catch (error) {
    console.warn(`order: ${(error as Error).message}`)
  }
}
