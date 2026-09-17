export interface SubtitleEntry {
  id: string
  startTime: string
  endTime: string
  text: string
}

// Translation only needs the chosen model now: credentials, project and quota
// live in the main process (the Antigravity account session). No API key or
// endpoint ever reaches the renderer.
export interface ApiSettings {
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
  /**
   * Present when some chunks failed after all retries. `partialData` is the
   * full ordered subtitle list where failed chunks still carry their original
   * (untranslated) text — the job reports `success: false` so the UI never
   * presents a partly-English file as a finished translation.
   */
  partialData?: SubtitleEntry[]
  failedChunks?: number[]
  totalChunks?: number
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

// ── Antigravity account ──────────────────────────────────────────────────────

export interface AntigravityAccount {
  email: string
  picture?: string
  plan: string
  projectId: string | null
  tierId: string | null
  connectedAt: number
}

export interface AccountStatus {
  signedIn: boolean
  account: AntigravityAccount | null
  // Present when a saved session exists but is no longer usable (expired
  // refresh token, revoked access, …) and a fresh login is required.
  needsReauth?: boolean
}

export interface AuthProgress {
  phase:
    | 'idle'
    | 'opening-browser'
    | 'waiting-callback'
    | 'exchanging'
    | 'onboarding'
    | 'complete'
    | 'cancelled'
    | 'error'
  message?: string
  authUrl?: string
}

export interface AntigravityModel {
  id: string
  name: string
  contextLength?: number
  maxOutputTokens?: number
}

export interface ModelQuota {
  id: string
  name: string
  /** Normalized 0–1000 scale (matches upstream remainingFraction * 1000). */
  used: number
  total: number
  remainingPercentage: number
  resetAt: string | null
  unlimited: boolean
  /** false = the API did not report a fraction (unknown, not necessarily 0). */
  fractionReported: boolean
}

export interface WeeklyQuota {
  key: string
  displayName: string
  used: number
  total: number
  remainingPercentage: number
  resetAt: string | null
  unlimited: boolean
  /** Which rate-limit window this is: a rolling 5-hour limit or the weekly one. */
  window?: 'weekly' | '5h'
}

export interface QuotaSummary {
  plan: string
  models: ModelQuota[]
  weekly: WeeklyQuota[]
  /** Google One AI credit balance when the account reports one. */
  credits: number | null
  fetchedAt: number
  error?: string
}

export interface ElectronAPI {
  // Antigravity auth
  beginAuth: () => Promise<IpcResponse<AuthProgress>>
  cancelAuth: () => Promise<IpcResponse<void>>
  getAuthStatus: () => Promise<IpcResponse<AccountStatus>>
  /** false = the OS keyring is unavailable, so the session can't be remembered. */
  canPersistSession: () => Promise<IpcResponse<boolean>>
  logout: () => Promise<IpcResponse<void>>
  onAuthProgress: (callback: (progress: AuthProgress) => void) => () => void
  onAuthStateChanged: (callback: (status: AccountStatus) => void) => () => void
  // Account data
  getQuota: () => Promise<IpcResponse<QuotaSummary>>
  refreshQuota: () => Promise<IpcResponse<QuotaSummary>>
  listModels: () => Promise<IpcResponse<AntigravityModel[]>>
  // Files
  importSrt: () => Promise<IpcResponse<ImportResult>>
  importSrtFromPath: (filePath: string) => Promise<IpcResponse<ImportResult>>
  exportSrt: (entries: SubtitleEntry[], suggestedName: string) => Promise<IpcResponse<string>>
  selectMkv: () => Promise<IpcResponse<string | null>>
  listMkvTracks: (mkvPath: string) => Promise<IpcResponse<MkvSubtitleTrack[]>>
  extractMkvTrack: (mkvPath: string, trackId: number) => Promise<IpcResponse<MkvExtractionResult>>
  getPathForFile: (file: File) => string
  // Translation
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
