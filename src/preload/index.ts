import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StudioAPI } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const studio: StudioAPI = {
  info: () => ipcRenderer.invoke('studio:info'),
  loadModel: () => ipcRenderer.invoke('studio:load'),
  generate: (req) => ipcRenderer.invoke('studio:generate', req),
  cancel: () => ipcRenderer.invoke('studio:cancel'),
  saveImage: (png, suggestedName) => ipcRenderer.invoke('studio:save', png, suggestedName),
  onStatus: (cb) => subscribe('studio:status', cb),
  onDownload: (cb) => subscribe('studio:download', cb),
  onStep: (cb) => subscribe('studio:step', cb),
  onLog: (cb) => subscribe('studio:log', cb)
}

contextBridge.exposeInMainWorld('studio', studio)
