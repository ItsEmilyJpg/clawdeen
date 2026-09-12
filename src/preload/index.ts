import { contextBridge, ipcRenderer } from 'electron'

import type { Board, Line } from '../shared/types'

/** The renderer never reaches the disk: it asks for the board and is told when a new one exists. */
const api = {
  board: (): Promise<Board> => ipcRenderer.invoke('board'),
  open: (url: string): Promise<void> => ipcRenderer.invoke('open', url),
  order: (ids: string[]): Promise<void> => ipcRenderer.invoke('order', ids),
  chat: (cli: string): Promise<Line[]> => ipcRenderer.invoke('chat', cli),
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
