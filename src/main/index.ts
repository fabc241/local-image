import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { GenerateRequest } from '../shared/types'
import { Studio } from './studio'

let mainWindow: BrowserWindow | null = null

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

const studio = new Studio({
  status: (s) => send('studio:status', s),
  download: (p) => send('studio:download', p),
  step: (p) => send('studio:step', p),
  log: (l) => send('studio:log', l)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Local Image',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111113',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('studio:info', () => studio.info())
  ipcMain.handle('studio:get-status', () => studio.getStatus())
  ipcMain.handle('studio:load', () => studio.load())
  ipcMain.handle('studio:generate', (_e, req: GenerateRequest) => studio.generate(req))
  ipcMain.handle('studio:cancel', () => studio.cancel())
  ipcMain.handle('studio:save', async (_e, png: Uint8Array, suggestedName: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath('pictures'), suggestedName),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, png)
    return filePath
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.fabc241.local-image')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Unload the model (and let the SDK close its worker) before quitting.
let disposed = false
app.on('before-quit', (event) => {
  if (disposed) return
  event.preventDefault()
  disposed = true
  studio
    .dispose()
    .catch((err) => console.error('Failed to unload model', err))
    .finally(() => app.quit())
})
