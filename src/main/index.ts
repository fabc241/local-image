import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { assertTrustedSender, denyAllPermissions, hardenWindow } from './security'
import { Studio } from './studio'
import { parseGenerateRequest, parseSaveRequest } from './validate'

// The electron-vite dev server, when running `npm run dev`.
const DEV_SERVER_URL = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined

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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  hardenWindow(mainWindow, DEV_SERVER_URL)

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Registers an IPC handler that only answers the app's own page.
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, DEV_SERVER_URL)
    return listener(event, ...args)
  })
}

function registerIpc(): void {
  handle('studio:info', () => studio.info())
  handle('studio:get-status', () => studio.getStatus())
  handle('studio:load', () => studio.load())
  handle('studio:generate', (_e, req) => studio.generate(parseGenerateRequest(req)))
  handle('studio:cancel', () => studio.cancel())
  handle('studio:save', async (_e, rawPng, rawName) => {
    const { png, name } = parseSaveRequest(rawPng, rawName)
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: join(app.getPath('pictures'), name),
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

  denyAllPermissions(session.defaultSession)
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
