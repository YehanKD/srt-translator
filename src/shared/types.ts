export interface SubtitleEntry {
  id: string
  startTime: string
  endTime: string
  text: string
}

export interface ApiSettings {
  endpointUrl: string
  apiKey: string
  modelId: string
}

export interface SubtitleChunk {
  index: number
  subtitles: SubtitleEntry[]
  totalChunks: number
}

export interface TranslationProgress {
  jobId: string
  chunkIndex: number
  totalChunks: number
  status: 'sending' | 'received' | 'error'
  errorMessage?: string
  partialResult?: SubtitleEntry[]
  activeChunks?: number
}

export interface TranslationComplete {
  jobId: string
  success: boolean
  data?: SubtitleEntry[]
  error?: string
}

export interface ModelInfo {
  id: string
  owned_by?: string
}

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface ImportResult {
  filePath: string
  fileName: string
  entries: SubtitleEntry[]
}

export interface MkvSubtitleTrack {
  id: number
  codecId: string
  codec: string
  language: string
  trackName: string
  isText: boolean
}

export interface MkvExtractionResult {
  fileName: string
  entries: SubtitleEntry[]
}

export interface ElectronAPI {
  importSrt: () => Promise<IpcResponse<ImportResult>>
  importSrtFromPath: (filePath: string) => Promise<IpcResponse<ImportResult>>
  exportSrt: (entries: SubtitleEntry[], suggestedName: string) => Promise<IpcResponse<string>>
  fetchModels: (endpointUrl: string, apiKey: string) => Promise<IpcResponse<ModelInfo[]>>
  selectMkv: () => Promise<IpcResponse<string | null>>
  listMkvTracks: (mkvPath: string) => Promise<IpcResponse<MkvSubtitleTrack[]>>
  extractMkvTrack: (mkvPath: string, trackId: number) => Promise<IpcResponse<MkvExtractionResult>>
  getPathForFile: (file: File) => string
  startTranslation: (entries: SubtitleEntry[], settings: ApiSettings, jobId: string) => void
  cancelTranslation: (jobId: string) => Promise<IpcResponse<void>>
  onTranslationProgress: (callback: (progress: TranslationProgress) => void) => () => void
  onTranslationComplete: (callback: (result: TranslationComplete) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
