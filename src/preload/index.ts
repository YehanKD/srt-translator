import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type {
  ElectronAPI,
  SubtitleEntry,
  ApiSettings,
  TranslationProgress,
  TranslationComplete,
  AuthProgress,
  AccountStatus,
  QuotaSummary,
  AntigravityModel
} from '@shared/types'

const electronAPI: ElectronAPI = {
  // ─── Antigravity auth ────────────────────────────────────────────────
  beginAuth: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_BEGIN),
  cancelAuth: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CANCEL),
  getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_STATUS),
  canPersistSession: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CAN_PERSIST),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),

  onAuthProgress: (callback: (progress: AuthProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AuthProgress) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AUTH_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.AUTH_PROGRESS, handler) }
  },
  onAuthStateChanged: (callback: (status: AccountStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AccountStatus) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.AUTH_STATE_CHANGED, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.AUTH_STATE_CHANGED, handler) }
  },

  // ─── Account data ─────────────────────────────────────────────────────
  getQuota: () => ipcRenderer.invoke(IPC_CHANNELS.QUOTA_GET),
  refreshQuota: () => ipcRenderer.invoke(IPC_CHANNELS.QUOTA_REFRESH),
  listModels: () => ipcRenderer.invoke(IPC_CHANNELS.LIST_MODELS),

  // ─── Files ────────────────────────────────────────────────────────────
  pickInput: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SRT),
  importSrtFromPath: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SRT_PATH, filePath),
  exportSrt: (entries: SubtitleEntry[], suggestedName: string, suggestedDir?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SRT, entries, suggestedName, suggestedDir),
  autoSaveSrt: (entries: SubtitleEntry[], fileName: string, dir: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTO_SAVE_SRT, entries, fileName, dir),
  selectMkv: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_MKV),
  listMkvTracks: (mkvPath: string) => ipcRenderer.invoke(IPC_CHANNELS.LIST_MKV_TRACKS, mkvPath),
  extractMkvTrack: (mkvPath: string, trackId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_MKV_TRACK, mkvPath, trackId),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // ─── Translation ─────────────────────────────────────────────────────
  startTranslation: (entries: SubtitleEntry[], settings: ApiSettings, jobId: string) => {
    ipcRenderer.send(IPC_CHANNELS.START_TRANSLATION, entries, settings, jobId)
  },
  cancelTranslation: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_TRANSLATION, jobId),
  openLog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOG),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),

  onTranslationProgress: (callback: (progress: TranslationProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TranslationProgress) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_PROGRESS, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.TRANSLATION_PROGRESS, handler) }
  },
  onTranslationComplete: (callback: (result: TranslationComplete) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TranslationComplete) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.TRANSLATION_COMPLETE, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.TRANSLATION_COMPLETE, handler) }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)