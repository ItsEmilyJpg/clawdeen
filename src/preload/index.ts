import { contextBridge, ipcRenderer } from 'electron'

import type { Board, Line, Locale, ThemeMode, Update } from '../shared/types'

/** The renderer never reaches the disk: it asks for the board and is told when a new one exists. */
const api = {
  board: (): Promise<Board> => ipcRenderer.invoke('board'),
  open: (url: string): Promise<void> => ipcRenderer.invoke('open', url),
  // The page draws itself from `color-scheme`; this is for the parts of the window it cannot reach,
  // the traffic lights and the colour behind the page before it has painted.
  theme: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke('theme', mode),
  // Which language the board speaks. It is kept by the main process, because the page keeps nothing.
  locale: (next: Locale): Promise<void> => ipcRenderer.invoke('locale', next),
  // Which repositories the board draws; the count in the tray is not affected by it on purpose.
  hide: (project: string, shown: boolean): Promise<void> =>
    ipcRenderer.invoke('hide', project, shown),
  // The order she dragged the repositories into, which the settings list and the lanes both read.
  projects: (names: string[]): Promise<void> => ipcRenderer.invoke('projects', names),
  order: (ids: string[]): Promise<void> => ipcRenderer.invoke('order', ids),
  // Parked by her: the one state on the board that is set rather than read.
  hold: (id: string, on: boolean): Promise<void> => ipcRenderer.invoke('hold', id, on),
  chat: (cli: string): Promise<Line[]> => ipcRenderer.invoke('chat', cli),
  // A release newer than the one running, and the one button that replaces it. Its own channel
  // rather than a field on the board: the board is rebuilt every few seconds off the sessions, and
  // this is read once at start off GitHub.
  update: (): Promise<Update | null> => ipcRenderer.invoke('update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('installUpdate'),
  onUpdate: (listen: (update: Update | null) => void): (() => void) => {
    const handler = (_event: unknown, update: Update | null): void => listen(update)
    ipcRenderer.on('update', handler)
    return () => ipcRenderer.removeListener('update', handler)
  },
  onBoard: (listen: (board: Board) => void): (() => void) => {
    const handler = (_event: unknown, board: Board): void => listen(board)
    ipcRenderer.on('board', handler)
    return () => ipcRenderer.removeListener('board', handler)
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore the same object, where context isolation is off
  window.api = api
}
