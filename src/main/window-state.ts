import { app, type BrowserWindow, type Rectangle, screen } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the window was when it was last put away, so it comes back where she left it. */
function file(): string {
  return join(app.getPath('userData'), 'window.json')
}

export function lastBounds(): Partial<Rectangle> {
  try {
    const kept = JSON.parse(readFileSync(file(), 'utf8')) as Rectangle
    // A screen that is no longer there would put the window where nobody can reach it.
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea
      return (
        kept.x < area.x + area.width &&
        kept.x + kept.width > area.x &&
        kept.y < area.y + area.height
      )
    })
    return visible ? kept : {}
  } catch {
    return {}
  }
}

export function rememberBounds(window: BrowserWindow): void {
  const keep = (): void => {
    if (window.isDestroyed() || window.isMinimized()) return
    try {
      writeFileSync(file(), JSON.stringify(window.getBounds()))
    } catch (error) {
      console.warn(`window: ${(error as Error).message}`)
    }
  }
  window.on('resized', keep)
  window.on('moved', keep)
  window.on('close', keep)
}
