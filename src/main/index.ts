import { app, BrowserWindow, Menu, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { registerIpcHandlers } from './ipc-handlers'
import { captureConsole, installCrashHandlers, log } from './modules/logger'

// Must be set BEFORE app.whenReady(): on Linux, Electron's safeStorage only
// reports encryption as available when it knows which keyring backend to use.
// Its auto-detection keys off XDG_CURRENT_DESKTOP, which is often unset on
// Wayland compositors (Hyprland/Omarchy), so it silently reports "unavailable"
// even with a working gnome-keyring — and the saved session would never be
// written. Point it at gnome-libsecret unless the user is clearly on KDE,
// whose wallet uses a different backend.
if (process.platform === 'linux') {
  const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ''} ${process.env.KDE_FULL_SESSION ?? ''}`
  const isKde = /kde|plasma/i.test(desktop)
  if (!isKde && !process.argv.some((a) => a.startsWith('--password-store'))) {
    app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
  }
}

// Install logging and crash capture FIRST, so a failure during startup is
// recorded rather than vanishing into a discarded stderr.
captureConsole()
installCrashHandlers()

let mainWindow: BrowserWindow | null = null

const DEFAULT_SIZE = { width: 1236, height: 958 }

function stateFile(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'window-state.json')
}

function loadSavedBounds(): { width: number; height: number } | null {
  try {
    const data = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (typeof data.width === 'number' && typeof data.height === 'number') {
      return { width: data.width, height: data.height }
    }
  } catch {
    /* no saved state yet */
  }
  return null
}

function createWindow(): void {
  Menu.setApplicationMenu(null)

  const saved = loadSavedBounds() ?? DEFAULT_SIZE
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.max(400, Math.min(saved.width, workArea.width))
  const height = Math.max(400, Math.min(saved.height, workArea.height))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  let saveTimer: NodeJS.Timeout | null = null
  const persistNow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const [w, h] = mainWindow.getSize()
      writeFileSync(stateFile(), JSON.stringify({ width: w, height: h }))
    } catch {
      /* ignore */
    }
  }
  mainWindow.on('resize', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistNow, 300)
  })
  mainWindow.on('close', persistNow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

registerIpcHandlers(() => mainWindow)

app.whenReady().then(() => {
  log.info(
    `app started — v${app.getVersion()}, electron ${process.versions.electron}, ${process.platform}/${process.arch}`
  )
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})