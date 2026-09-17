import { app, BrowserWindow, Menu, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { registerIpcHandlers } from './ipc-handlers'

// Must be set BEFORE app.whenReady(): on Linux, Electron's safeStorage only
// reports encryption as available when it knows which keyring backend to use.
// Without this it returns false even on a machine with a working
// gnome-keyring/libsecret, so the saved session would never be written.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
}

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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})