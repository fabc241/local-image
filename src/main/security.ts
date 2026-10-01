// Window hardening: the app shows only its own bundled page, opens only https
// links (in the default browser), and grants no device permissions.
import { shell, type BrowserWindow, type IpcMainInvokeEvent, type Session } from 'electron'
import { isAllowedExternalUrl } from './validate'

// True when `url` is the app's own page: the bundled renderer, or the
// electron-vite dev server during development.
export function isAppPage(url: string, devServerUrl: string | undefined): boolean {
  try {
    const u = new URL(url)
    if (devServerUrl) return u.origin === new URL(devServerUrl).origin
    return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html')
  } catch {
    return false
  }
}

export function hardenWindow(win: BrowserWindow, devServerUrl: string | undefined): void {
  const wc = win.webContents

  // No pop-up windows; https links go to the default browser, nothing else.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The window never navigates away from the app (e.g. a file dropped outside
  // the drop zone, or a link inside the page).
  const blockNavigation = (event: { preventDefault: () => void }, url: string): void => {
    if (!isAppPage(url, devServerUrl)) event.preventDefault()
  }
  wc.on('will-navigate', blockNavigation)
  wc.on('will-redirect', blockNavigation)

  // No <webview> tags.
  wc.on('will-attach-webview', (event) => event.preventDefault())
}

// The app needs no camera, microphone, location, notifications, etc.
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

// IPC is accepted only from the app's own page in the main frame.
export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  devServerUrl: string | undefined
): void {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null || !isAppPage(frame.url, devServerUrl)) {
    throw new Error('Request rejected: unknown sender')
  }
}
