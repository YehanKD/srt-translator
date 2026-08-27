import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type { ElectronAPI, SubtitleEntry, ApiSettings, TranslationProgress, TranslationComplete } from '@shared/types'

const electronAPI: ElectronAPI = {
  importSrt: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SRT),
  importSrtFromPath: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SRT_PATH, filePath),
  exportSrt: (entries: SubtitleEntry[], suggestedName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SRT, entries, suggestedName),
  fetchModels: (endpointUrl: string, apiKey: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FETCH_MODELS, endpointUrl, apiKey),
  selectMkv: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_MKV),
  listMkvTracks: (mkvPath: string) => ipcRenderer.invoke(IPC_CHANNELS.LIST_MKV_TRACKS, mkvPath),
  extractMkvTrack: (mkvPath: string, trackId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_MKV_TRACK, mkvPath, trackId),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  startTranslation: (entries: SubtitleEntry[], settings: ApiSettings, jobId: string) => {
    ipcRenderer.send(IPC_CHANNELS.START_TRANSLATION, entries, settings, jobId)
  },
  cancelTranslation: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_TRANSLATION, jobId),
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