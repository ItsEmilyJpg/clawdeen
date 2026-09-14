import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  Tray
} from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { watch } from 'node:fs'
import { join } from 'node:path'

import { say, setLocale, stateWord } from '../shared/i18n'
import type { Board, Locale, Session, StateWord, ThemeMode, UsageWindow } from '../shared/types'
import { board } from './board'
import { saveSettings, settings } from './settings'
import { claimCard, underClaim, type Claim } from './focus'
import { openSession, records } from './records'
import { chat } from './chat'
import { transcripts } from './transcripts'
import { hooksInstalled, installHooks, removeHooks } from './hooks'
import { listen } from './live'
import { keepOrder } from './order'
import { lastBounds, rememberBounds } from './window-state'
import { ago, burnVerdict, doubtsOf, inWords, stateLabel, usageRows } from '../shared/words'
import trayIcon from '../../resources/trayTemplate.png?asset'
import { SESSIONS, TASKS, TRANSCRIPTS } from './paths'

/** The app focuses this session; "last" is the only other value it accepts. */
const APP_SESSION = 'claude://code/continue?session='
const MENU_LIMIT = 15
/** `--ground` of each theme, so the window is never a colour the page is about to replace. */
const DARK_GROUND = '#10161c'
const LIGHT_GROUND = '#f4f5f7'

type Dot = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'grey'

/** AppKit draws these four, so the menu gets its colours without an icon file of our own. */
const DOT_IMAGE: { [key in Dot]: [string, number] } = {
  green: ['NSStatusAvailable', 0],
  amber: ['NSStatusPartiallyAvailable', 0],
  red: ['NSStatusUnavailable', 0],
  // A blue one is the green one turned around the wheel; AppKit has no blue status image, and none
  // in the purple a merged pull request is drawn in either.
  blue: ['NSStatusAvailable', 0.58],
  purple: ['NSStatusAvailable', 0.76],
  grey: ['NSStatusNone', 0]
}

const DOT: { [key in StateWord]: Dot } = {
  working: 'green',
  'gate-running': 'blue',
  'gate-queued': 'amber',
  'task-running': 'blue',
  'task-queued': 'grey',
  'waiting-for-you': 'amber',
  'waiting-for-ci': 'blue',
  'waiting-for-issue': 'grey',
  'waiting-for-other': 'grey',
  'no-pr': 'grey',
  draft: 'amber',
  conflict: 'red',
  'ci-running': 'blue',
  'ci-red': 'red',
  'changes-requested': 'amber',
  mergeable: 'green',
  'in-review': 'blue',
  open: 'blue',
  merged: 'purple',
  closed: 'grey'
}

const drawn = new Map<Dot, NativeImage>()

function dot(colour: Dot | undefined): NativeImage {
  // The history keeps words this version no longer has, and a menu is not worth a crash.
  const known: Dot = colour && colour in DOT_IMAGE ? colour : 'grey'
  const held = drawn.get(known)
  if (held) return held
  const [name, hue] = DOT_IMAGE[known]
  const image = nativeImage
    .createFromNamedImage(name, [hue, 0.5, 0.5])
    .resize({ width: 12, height: 12 })
  drawn.set(known, image)
  return image
}

/** Grey where the reading is doubted, amber for the row that says why, otherwise how fast it burns. */
function meterDot(window: UsageWindow | null): Dot {
  if (!window) return 'amber'
  if (doubtsOf(window).length > 0) return 'grey'
  return { ok: 'green', warn: 'amber', danger: 'red' }[burnVerdict(window.burn, window.left)] as Dot
}

/** A file changes in bursts, and the board is not worth building for each line of a transcript. */
const SETTLE = 400
/**
 * Which card is open in the app is not worth that wait. Measured: the records read in 63 to 83 ms,
 * a whole board is 72 ms on a warm `gh` cache and 1624 ms once it has gone cold, and the settle
 * above adds its own 400 and restarts on the next write.
 */
const FOCUS_SETTLE = 60
/** Nothing watches a lock inside a worktree or a pull request on GitHub, so the board is swept anyway. */
const SWEEP = 15_000

let window: BrowserWindow | null = null
let tray: Tray | null = null
let latest: Board | null = null
let waiting = new Set<string>()
let announced = false
let settling: NodeJS.Timeout | null = null
let focusing: NodeJS.Timeout | null = null
/**
 * What the board itself opened, and when. The app writes its own record 1 to 3.5 seconds after the
 * click, and every pass in between reads that stale record: without this the mark set on opening is
 * wiped by the next sweep and the wait is back.
 */
let claimed: Claim | null = null
/**
 * What the records last said, which is what a claim is measured against. Never the mark on the
 * board: that one is the previous claim talking, and a claim answering itself is the flicker.
 */
let recorded: string | null = null
let leaving = false
let wired = false

function createWindow(): void {
  window = new BrowserWindow({
    width: 1040,
    height: 760,
    ...lastBounds(),
    show: false,
    title: 'Clawdeen',
    titleBarStyle: 'hiddenInset',
    // Without this the first click into an unfocused window only raises it, so everything on the
    // board needs clicking twice.
    acceptFirstMouse: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_GROUND : LIGHT_GROUND,
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
  const asking = sessions.filter((session) => session.activity === 'waiting-for-you').length
  const working = sessions.filter((session) => session.activity === 'working').length
  if (asking > 0) return `● ${asking}`
  // Never nothing: an empty title with an empty image is a tray icon that cannot be clicked.
  return working > 0 ? `○ ${working}` : '·'
}

function link(label: string, url: string, colour: Dot): MenuItemConstructorOptions {
  return {
    label,
    icon: dot(colour),
    click: (): void => {
      openUrl(url)
    }
  }
}

/** The rows of one session, the shape the menu bar plugin had them in: everything on the surface. */
function trayRows(session: Session): MenuItemConstructorOptions[] {
  const change = session.change
  const doing = session.activity
    ? [
        stateWord(session.activity) + (session.about ? ` · ${session.about}` : ''),
        session.extra && stateWord(session.extra)
      ]
        .filter(Boolean)
        .join(' + ')
    : ''
  const rows: MenuItemConstructorOptions[] = [
    link(
      doing ? `${session.headline}   —   ${doing}` : session.headline,
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
  // The row without a window is the doubt the windows share, which is why it is drawn in amber.
  const meters = usageRows(current?.usage ?? []).map(({ label, window }) => ({
    label,
    icon: dot(meterDot(window)),
    enabled: false
  }))
  return Menu.buildFromTemplate([
    ...(rows.length > 0 ? rows : [{ label: say('noSessions'), enabled: false }]),
    ...meters,
    ...(spent.length > 0
      ? [{ type: 'separator' as const }, { label: 'Dnes', enabled: false }, ...spent]
      : []),
    { type: 'separator' },
    { label: say('openBoard'), click: show },
    { label: 'Obnovit', click: () => void refresh() },
    {
      label: say('reportState'),
      type: 'checkbox',
      checked: wired,
      click: () => void wire(!wired)
    },
    {
      label: say('startAtLogin'),
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { label: say('quit'), click: () => app.quit() }
  ])
}

/**
 * The hook has to be written into the Claude settings, which are hers, so it is asked for rather
 * than done: whoever downloads a build has no checkout to run an installer from.
 */
async function wire(on: boolean): Promise<void> {
  if (on) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: say('wireQuestion'),
      detail: say('wireDetail'),
      buttons: [say('wireConnect'), say('wireLeave')],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return
    try {
      const kept = await installHooks()
      wired = true
      await dialog.showMessageBox({ message: say('wireDone'), detail: say('wireBackup', kept) })
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: say('wireFailed'),
        detail: (error as Error).message
      })
    }
  } else {
    await removeHooks()
    wired = false
  }
  await refresh()
}

/** Only the turn into waiting is news; a session that has been waiting all along must not ring again. */
function announce(sessions: Session[]): void {
  const now = new Set<string>()
  for (const session of sessions) {
    if (session.activity !== 'waiting-for-you') continue
    now.add(session.id)
    // The first board of a run is the state of the world, not a set of changes to ring about.
    if (waiting.has(session.id) || !announced) continue
    const notification = new Notification({
      title: say('waitingTitle'),
      body: [session.headline, session.place].filter(Boolean).join(' — ')
    })
    notification.on('click', () => {
      openUrl(APP_SESSION + session.id)
    })
    notification.show()
  }
  waiting = now
  announced = true
}

async function refresh(): Promise<void> {
  try {
    latest = applyClaim(await board())
  } catch (error) {
    console.error(`board: ${(error as Error).stack}`)
    return
  }
  // The window is told first and separately: a tray that cannot draw itself must not stop the board.
  if (window && !window.isDestroyed()) window.webContents.send('board', latest)
  try {
    announce(latest.sessions)
    tray?.setTitle(trayTitle(latest.sessions))
    tray?.setContextMenu(trayMenu(latest))
  } catch (error) {
    console.error(`tray: ${(error as Error).stack}`)
  }
}

function settle(): void {
  if (settling) clearTimeout(settling)
  settling = setTimeout(() => {
    settling = null
    void refresh()
  }, SETTLE)
}

/**
 * Which card the app has open is read off the records alone, so it does not have to wait behind a
 * settle meant for transcripts or behind `gh`. Nothing else on the board is touched: the rest of
 * this pass is still whatever the last full one worked out, and that pass is on its way anyway.
 */
async function focusPass(): Promise<void> {
  if (!latest) return
  try {
    markFocused(withClaim(openSession(await records(Date.now() / 1000))))
  } catch (error) {
    console.warn(`focus: ${(error as Error).message}`)
  }
}

/** The one door the records come through, so every reading of them is measured against the claim. */
function withClaim(open: string | null): string | null {
  recorded = open
  const { focus, held } = underClaim(claimed, open, Date.now())
  claimed = held
  return focus
}

/** A whole board is built with the records' idea of focus, which the claim has to survive. */
function applyClaim(built: Board): Board {
  const open = built.sessions.find((session) => session.focused)?.id ?? null
  const wanted = withClaim(open)
  if (wanted === open) return built
  return {
    ...built,
    sessions: built.sessions.map((session) => ({ ...session, focused: session.id === wanted }))
  }
}

/** One place says which card is the open one, so the two ways of learning it cannot disagree. */
function markFocused(id: string | null): void {
  if (!latest) return
  if ((latest.sessions.find((session) => session.focused)?.id ?? null) === id) return
  latest = {
    ...latest,
    sessions: latest.sessions.map((session) => ({ ...session, focused: session.id === id }))
  }
  if (window && !window.isDestroyed()) window.webContents.send('board', latest)
}

/**
 * Opening a session from the board is the one moment the app's own record is not needed, because
 * the board is the one doing the opening. That record is worth waiting for nowhere: measured, it
 * lands 1 to 3.5 seconds after the click, and it is the app that is late, not this.
 */
function openUrl(url: string): void {
  if (url.startsWith(APP_SESSION)) {
    const id = url.slice(APP_SESSION.length)
    if (latest?.sessions.some((session) => session.id === id)) {
      claimed = claimCard(claimed, id, recorded, Date.now())
      markFocused(id)
    }
  }
  void shell.openExternal(url)
}

function focusSettle(): void {
  if (focusing) clearTimeout(focusing)
  focusing = setTimeout(() => {
    focusing = null
    void focusPass()
  }, FOCUS_SETTLE)
}

function watchSources(): void {
  for (const root of [SESSIONS, TRANSCRIPTS, TASKS]) {
    try {
      // Only the records carry the focus, so only they are worth the second, faster pass.
      const heard =
        root === SESSIONS
          ? (): void => {
              focusSettle()
              settle()
            }
          : settle
      watch(root, { recursive: true, persistent: false }, heard)
    } catch (error) {
      console.warn(`watch ${root}: ${(error as Error).message}`)
    }
  }
  setInterval(() => void refresh(), SWEEP)
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('cz.itsemilyjpg.clawdeen')
  // Before anything draws: the tray, the menu and the first board all ask for words.
  setLocale(settings().locale)
  app.on('browser-window-created', (_event, created) => optimizer.watchWindowShortcuts(created))

  ipcMain.handle('board', async () => latest ?? (await board()))
  ipcMain.handle('open', (_event, url: string) => openUrl(url))
  ipcMain.handle('chat', async (_event, cli: string) => {
    const path = (await transcripts()).get(cli)
    return path ? chat(path) : []
  })
  ipcMain.handle('order', async (_event, ids: string[]) => {
    await keepOrder(ids)
    await refresh()
  })
  // The language outlives the run, so it is written down rather than asked of the system again, and
  // the tray is rebuilt because its menu is already drawn in the language before this one.
  ipcMain.handle('locale', async (_event, next: Locale) => {
    saveSettings({ locale: next })
    setLocale(next)
    await refresh()
  })
  // The window frame is not the page: the traffic lights and the colour behind an unpainted window
  // come from the native theme, and the page's own choice has to reach it or the two disagree.
  ipcMain.handle('theme', (_event, mode: ThemeMode) => {
    nativeTheme.themeSource = mode
    window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_GROUND : LIGHT_GROUND)
  })

  // A template image is the menu bar's own black and white; the count rides beside it as the title.
  const bar = nativeImage.createFromPath(trayIcon)
  bar.setTemplateImage(true)
  tray = new Tray(bar)
  tray.setToolTip('Clawdeen')
  tray.on('click', show)

  void hooksInstalled()
    .then((found) => {
      wired = found
    })
    .catch(() => undefined)

  createWindow()
  void refresh()
  watchSources()
  void listen(settle).catch((error) => console.warn(`live: ${(error as Error).message}`))

  app.on('activate', () => show())
})

app.on('before-quit', () => {
  leaving = true
})

// The tray is the point of this application, so the last window closing is not the end of it.
app.on('window-all-closed', () => {})
