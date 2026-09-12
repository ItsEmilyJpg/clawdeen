import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { watch } from 'node:fs'
import { join } from 'node:path'

import type { Board, Session, StateWord } from '../shared/types'
import { board } from './board'
import { chat } from './chat'
import { transcripts } from './transcripts'
import { keepOrder } from './order'
import { lastBounds, rememberBounds } from './window-state'
import { ago, inWords, stateLabel } from '../shared/words'
import trayIcon from '../../resources/trayTemplate.png?asset'
import { SESSIONS, TASKS, TRANSCRIPTS } from './paths'

/** The app focuses this session; "last" is the only other value it accepts. */
const APP_SESSION = 'claude://code/continue?session='
const MENU_LIMIT = 15

type Dot = 'green' | 'amber' | 'red' | 'blue' | 'grey'

/** AppKit draws these four, so the menu gets its colours without an icon file of our own. */
const DOT_IMAGE: { [key in Dot]: [string, number] } = {
  green: ['NSStatusAvailable', 0],
  amber: ['NSStatusPartiallyAvailable', 0],
  red: ['NSStatusUnavailable', 0],
  // A blue one is the green one turned around the wheel; AppKit has no blue status image.
  blue: ['NSStatusAvailable', 0.58],
  grey: ['NSStatusNone', 0]
}

const DOT: { [key in StateWord]: Dot } = {
  pracuje: 'green',
  'gate běží': 'blue',
  'gate ve frontě': 'amber',
  'úloha běží': 'blue',
  'čeká na tebe': 'amber',
  'bez PR': 'grey',
  koncept: 'amber',
  konflikt: 'red',
  'CI běží': 'blue',
  'CI červené': 'red',
  'změny žádané': 'amber',
  'k mergi': 'green',
  'k review': 'blue',
  otevřené: 'blue',
  sloučené: 'blue',
  zavřené: 'grey'
}

const drawn = new Map<Dot, NativeImage>()

function dot(colour: Dot): NativeImage {
  const held = drawn.get(colour)
  if (held) return held
  const [name, hue] = DOT_IMAGE[colour]
  const image = nativeImage
    .createFromNamedImage(name, [hue, 0.5, 0.5])
    .resize({ width: 12, height: 12 })
  drawn.set(colour, image)
  return image
}

/** A file changes in bursts, and the board is not worth building for each line of a transcript. */
const SETTLE = 400
/** Nothing watches a lock inside a worktree or a pull request on GitHub, so the board is swept anyway. */
const SWEEP = 15_000

let window: BrowserWindow | null = null
let tray: Tray | null = null
let latest: Board | null = null
let waiting = new Set<string>()
let announced = false
let settling: NodeJS.Timeout | null = null
let leaving = false

function createWindow(): void {
  window = new BrowserWindow({
    width: 1040,
    height: 760,
    ...lastBounds(),
    show: false,
    title: 'Claude session',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#10161c',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  rememberBounds(window)
  window.on('ready-to-show', () => window?.show())
  // Closing puts it away rather than ending it; the tray keeps counting either way.
  window.on('close', (event) => {
    if (leaving) return
    event.preventDefault()
    window?.hide()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function show(): void {
  if (!window || window.isDestroyed()) createWindow()
  window?.show()
  window?.focus()
}

function trayTitle(sessions: Session[]): string {
  const asking = sessions.filter((session) => session.activity === 'čeká na tebe').length
  const working = sessions.filter((session) => session.activity === 'pracuje').length
  if (asking > 0) return `● ${asking}`
  // Never nothing: an empty title with an empty image is a tray icon that cannot be clicked.
  return working > 0 ? `○ ${working}` : '·'
}

function link(label: string, url: string, colour: Dot): MenuItemConstructorOptions {
  return {
    label,
    icon: dot(colour),
    click: (): void => {
      void shell.openExternal(url)
    }
  }
}

/** The rows of one session, the shape the menu bar plugin had them in: everything on the surface. */
function trayRows(session: Session): MenuItemConstructorOptions[] {
  const change = session.change
  const rows: MenuItemConstructorOptions[] = [
    link(
      session.headline,
      APP_SESSION + session.id,
      session.activity ? DOT[session.activity] : 'grey'
    )
  ]
  rows.push(
    change
      ? link(
          `${change.label} · ${stateLabel(session.state, change)}`,
          change.url,
          DOT[session.state]
        )
      : { label: stateLabel(session.state, null), icon: dot(DOT[session.state]), enabled: false }
  )
  for (const job of change?.failed ?? []) {
    rows.push(
      job.url
        ? link(job.label, job.url, 'red')
        : { label: job.label, icon: dot('red'), enabled: false }
    )
  }
  if (session.issue) rows.push(link(session.issue.label, session.issue.url, 'blue'))
  rows.push({ label: `${session.place} · ${ago(session.last)}`, enabled: false })
  return rows
}

function trayMenu(current: Board | null): Menu {
  const sessions = current?.sessions ?? []
  const rows = sessions
    .slice(0, MENU_LIMIT)
    .flatMap((session) => [...trayRows(session), { type: 'separator' as const }])
  const spent = (current?.today ?? []).map((spell) => ({
    label: `${spell.word} ${inWords(spell.seconds)}`,
    icon: dot(DOT[spell.word]),
    enabled: false
  }))
  const meters = (current?.usage ?? []).map((window) => ({
    label:
      `${window.short} ${Math.round(window.used)} % · reset za ${inWords(window.left)}` +
      (window.pace ? ` · tempo ${window.pace.toFixed(1).replace('.', ',')}×` : ''),
    icon: dot(window.used >= 85 ? 'red' : window.used >= 60 ? 'amber' : 'green'),
    enabled: false
  }))
  return Menu.buildFromTemplate([
    ...(rows.length > 0
      ? rows
      : [{ label: 'Žádná session za posledních sedm dní', enabled: false }]),
    ...meters,
    ...(spent.length > 0
      ? [{ type: 'separator' as const }, { label: 'Dnes', enabled: false }, ...spent]
      : []),
    { type: 'separator' },
    { label: 'Otevřít přehled', click: show },
    { label: 'Obnovit', click: () => void refresh() },
    {
      label: 'Spouštět po přihlášení',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { label: 'Ukončit', click: () => app.quit() }
  ])
}

/** Only the turn into waiting is news; a session that has been waiting all along must not ring again. */
function announce(sessions: Session[]): void {
  const now = new Set<string>()
  for (const session of sessions) {
    if (session.activity !== 'čeká na tebe') continue
    now.add(session.id)
    // The first board of a run is the state of the world, not a set of changes to ring about.
    if (waiting.has(session.id) || !announced) continue
    const notification = new Notification({
      title: 'Čeká na tebe',
      body: [session.headline, session.place].filter(Boolean).join(' — ')
    })
    notification.on('click', () => {
      void shell.openExternal(APP_SESSION + session.id)
    })
    notification.show()
  }
  waiting = now
  announced = true
}

async function refresh(): Promise<void> {
  try {
    latest = await board()
  } catch (error) {
    console.error(`board: ${(error as Error).stack}`)
    return
  }
  announce(latest.sessions)
  tray?.setTitle(trayTitle(latest.sessions))
  tray?.setContextMenu(trayMenu(latest))
  if (window && !window.isDestroyed()) window.webContents.send('board', latest)
}

function settle(): void {
  if (settling) clearTimeout(settling)
  settling = setTimeout(() => {
    settling = null
    void refresh()
  }, SETTLE)
}

function watchSources(): void {
  for (const root of [SESSIONS, TRANSCRIPTS, TASKS]) {
    try {
      watch(root, { recursive: true, persistent: false }, settle)
    } catch (error) {
      console.warn(`watch ${root}: ${(error as Error).message}`)
    }
  }
  setInterval(() => void refresh(), SWEEP)
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('cz.hadik.claude-sessions')
  app.on('browser-window-created', (_event, created) => optimizer.watchWindowShortcuts(created))

  ipcMain.handle('board', async () => latest ?? (await board()))
  ipcMain.handle('open', (_event, url: string) => shell.openExternal(url))
  ipcMain.handle('chat', async (_event, cli: string) => {
    const path = (await transcripts()).get(cli)
    return path ? chat(path) : []
  })
  ipcMain.handle('order', async (_event, ids: string[]) => {
    await keepOrder(ids)
    await refresh()
  })

  // A template image is the menu bar's own black and white; the count rides beside it as the title.
  const bar = nativeImage.createFromPath(trayIcon)
  bar.setTemplateImage(true)
  tray = new Tray(bar)
  tray.setToolTip('Claude session')
  tray.on('click', show)

  createWindow()
  void refresh()
  watchSources()

  app.on('activate', () => show())
})

app.on('before-quit', () => {
  leaving = true
})

// The tray is the point of this application, so the last window closing is not the end of it.
app.on('window-all-closed', () => {})
