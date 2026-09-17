import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type { SubtitleEntry, ApiSettings, IpcResponse, AuthProgress, AccountStatus, QuotaSummary } from '@shared/types'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { importSrtFile, exportSrtFile, selectMkvFile } from './modules/file-io'
import { parseSrt, serializeSrt } from './modules/srt-parser'
import { translateAll, TranslationIncompleteError } from './modules/translation-engine'

// Antigravity modules
import {
  startOAuthListener,
  awaitRedirectUri,
  generateOAuthState,
  buildAuthUrl,
  exchangeCodeForTokens
} from './modules/antigravity/oauth'
import { getSession, setSession, clearSession, getAccount, getAccessToken, logout, restoreSession } from './modules/antigravity/session'
import { canPersistSession } from './modules/antigravity/storage'
import { loadCodeAssist, onboardUser, fetchUserInfo } from './modules/antigravity/bootstrap'
import { fetchQuota } from './modules/antigravity/quota'
import { pickChatModels, ANTIGRAVITY_PUBLIC_MODELS, ANTIGRAVITY_DEFAULT_MODEL_ID } from './modules/antigravity/catalog'

const jobs = new Map<string, AbortController>()
let authListener: ReturnType<typeof startOAuthListener> | null = null
let authTimeout: NodeJS.Timeout | null = null

function clearAuthTimeout(): void {
  if (authTimeout) {
    clearTimeout(authTimeout)
    authTimeout = null
  }
}

function emitAuthProgress(window: BrowserWindow | null, progress: AuthProgress): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.AUTH_PROGRESS, progress)
  }
}

function emitAuthStateChanged(window: BrowserWindow | null): void {
  const status: AccountStatus = {
    signedIn: !!getSession(),
    account: getAccount(),
    needsReauth: false
  }
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.AUTH_STATE_CHANGED, status)
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // ─── Antigravity auth ───────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.AUTH_CAN_PERSIST, (): IpcResponse<boolean> => {
    return { success: true, data: canPersistSession() }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_BEGIN, async (): Promise<IpcResponse<AuthProgress>> => {
    const window = getWindow()
    if (authListener) {
      authListener.close()
      authListener = null
    }
    clearAuthTimeout()

    try {
      authListener = startOAuthListener()
      const redirectUri = await awaitRedirectUri(authListener)
      const state = generateOAuthState()
      const authUrl = buildAuthUrl(redirectUri, state)

      emitAuthProgress(window, { phase: 'opening-browser', message: 'Opening Google sign-in...', authUrl })

      // Open the browser
      const { shell } = await import('electron')
      await shell.openExternal(authUrl)

      emitAuthProgress(window, { phase: 'waiting-callback', message: 'Waiting for Google callback...' })

      // Wait for the callback with timeout
      const timeoutMs = 5 * 60 * 1000
      let resolved = false

      const codePromise = authListener.waitForCode
      const timeoutPromise = new Promise<never>((_, reject) => {
        authTimeout = setTimeout(() => {
          reject(new Error('OAuth timeout (5 minutes)'))
        }, timeoutMs)
      })

      const result = await Promise.race([codePromise, timeoutPromise])

      clearAuthTimeout()
      resolved = true

      if (!result || !result.code) {
        throw new Error('No authorization code received')
      }

      emitAuthProgress(window, { phase: 'exchanging', message: 'Exchanging code for tokens...' })

      const tokens = await exchangeCodeForTokens(result.code, redirectUri)

      emitAuthProgress(window, { phase: 'onboarding', message: 'Loading account info...' })

      // Fetch user info
      const userInfo = await fetchUserInfo(tokens.accessToken)
      if (!userInfo) {
        throw new Error('Could not fetch user info')
      }

      // Load Code Assist project
      let loadResult = await loadCodeAssist(tokens.accessToken)
      if (!loadResult) {
        // No project — try onboarding
        loadResult = await onboardUser(tokens.accessToken)
        if (!loadResult) {
          throw new Error('No Cloud Code project available for this account')
        }
      }

      const session = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        email: userInfo.email,
        picture: userInfo.picture,
        plan: loadResult.plan,
        projectId: loadResult.projectId,
        tierId: loadResult.tierId,
        connectedAt: Date.now()
      }

      setSession(session)
      emitAuthProgress(window, { phase: 'complete', message: 'Signed in successfully' })
      emitAuthStateChanged(window)

      // Close the listener
      if (authListener) {
        authListener.close()
        authListener = null
      }

      return { success: true, data: { phase: 'complete', message: 'Signed in successfully' } }
    } catch (err) {
      clearAuthTimeout()
      if (authListener) {
        authListener.close()
        authListener = null
      }
      const errorMsg = err instanceof Error ? err.message : String(err)
      emitAuthProgress(window, { phase: 'error', message: errorMsg })
      return { success: false, error: errorMsg }
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_CANCEL, async (): Promise<IpcResponse<void>> => {
    if (authListener) {
      authListener.close()
      authListener = null
    }
    clearAuthTimeout()
    const window = getWindow()
    emitAuthProgress(window, { phase: 'cancelled', message: 'Sign-in cancelled' })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async (): Promise<IpcResponse<AccountStatus>> => {
    // First call after launch: try to restore the saved session so the user is
    // already signed in instead of being asked to sign in again.
    if (!getSession()) {
      await restoreSession().catch(() => false)
    }

    const session = getSession()
    const status: AccountStatus = {
      signedIn: !!session,
      account: getAccount(),
      needsReauth: false
    }
    // Check if token is still valid by trying to get access token
    if (session) {
      try {
        const token = await getAccessToken()
        if (!token) {
          status.needsReauth = true
          status.signedIn = false
        }
      } catch {
        status.needsReauth = true
        status.signedIn = false
      }
    }
    return { success: true, data: status }
  })

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (): Promise<IpcResponse<void>> => {
    await logout()
    const window = getWindow()
    emitAuthStateChanged(window)
    return { success: true }
  })

  // ─── Antigravity quota ──────────────────────────────────────────────

  /**
   * Shared quota loader. `forceRefresh` bypasses the 60s cache — used by the
   * Refresh buttons, which must actually re-hit the upstream RPCs.
   */
  async function loadQuota(forceRefresh = false): Promise<IpcResponse<QuotaSummary>> {
    const session = getSession()
    if (!session) {
      return { success: false, error: 'Not signed in' }
    }

    try {
      const token = await getAccessToken()
      if (!token) {
        return { success: false, error: 'Session expired, please sign in again' }
      }

      const result = await fetchQuota(token, session.projectId, forceRefresh)
      const models = result.models.map((m) => ({
        id: m.id,
        name: m.name,
        used: m.used,
        total: m.total,
        remainingPercentage: m.remainingPercentage,
        resetAt: m.resetAt,
        unlimited: m.unlimited,
        fractionReported: m.fractionReported
      }))

      const weekly = result.weekly.map((w) => ({
        key: w.key,
        displayName: w.displayName,
        used: w.used,
        total: w.total,
        remainingPercentage: w.remainingPercentage,
        resetAt: w.resetAt,
        unlimited: w.unlimited,
        window: w.window
      }))

      return {
        success: true,
        data: {
          // The quota RPCs don't carry the tier, so trust the plan resolved at
          // sign-in (from loadCodeAssist's paidTier) over their empty default.
          plan: session.plan || result.plan,
          models,
          weekly,
          credits: null,
          fetchedAt: Date.now()
        }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle(IPC_CHANNELS.QUOTA_GET, () => loadQuota(false))
  ipcMain.handle(IPC_CHANNELS.QUOTA_REFRESH, () => loadQuota(true))

  // ─── Antigravity models ─────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.LIST_MODELS, async (): Promise<IpcResponse<{ id: string; name: string }[]>> => {
    const session = getSession()
    if (!session) {
      return { success: false, error: 'Not signed in' }
    }

    try {
      const token = await getAccessToken()
      if (!token) {
        return { success: false, error: 'Session expired, please sign in again' }
      }

      // First try to get available models from the quota endpoint
      const quotaResult = await fetchQuota(token, session.projectId)
      const availableIds = quotaResult.models.map((m) => m.id)

      // If we have available models, use those
      if (availableIds.length > 0) {
        const models = pickChatModels(availableIds)
        return { success: true, data: models }
      }

      // Fallback to static catalog
      return {
        success: true,
        data: ANTIGRAVITY_PUBLIC_MODELS.map((m) => ({ id: m.id, name: m.name }))
      }
    } catch (err) {
      // Fallback to static catalog on error
      return {
        success: true,
        data: ANTIGRAVITY_PUBLIC_MODELS.map((m) => ({ id: m.id, name: m.name }))
      }
    }
  })

  // ─── File operations (unchanged) ────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.IMPORT_SRT, async (): Promise<IpcResponse> => {
    try {
      const result = await importSrtFile()
      if (!result) return { success: true, data: null }
      const entries = parseSrt(result.content)
      return { success: true, data: { filePath: result.filePath, fileName: result.fileName, entries } }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXPORT_SRT, async (_event, entries: SubtitleEntry[], suggestedName: string): Promise<IpcResponse> => {
    try {
      const content = serializeSrt(entries)
      const savedPath = await exportSrtFile(content, suggestedName)
      return { success: true, data: savedPath }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IMPORT_SRT_PATH, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      const content = await readFile(filePath, 'utf-8')
      const entries = parseSrt(content)
      return { success: true, data: { filePath, fileName: basename(filePath), entries } }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SELECT_MKV, async (): Promise<IpcResponse> => {
    try {
      const path = await selectMkvFile()
      return { success: true, data: path }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LIST_MKV_TRACKS, async (_event, mkvPath: string): Promise<IpcResponse> => {
    try {
      const { getMkvSubtitleTracks } = await import('./modules/mkv-extract')
      const tracks = await getMkvSubtitleTracks(mkvPath)
      return { success: true, data: tracks }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXTRACT_MKV_TRACK, async (_event, mkvPath: string, trackId: number): Promise<IpcResponse> => {
    try {
      const { getMkvSubtitleTracks, extractMkvSubtitleTrack } = await import('./modules/mkv-extract')
      const tracks = await getMkvSubtitleTracks(mkvPath)
      const track = tracks.find((t) => t.id === trackId)
      if (!track) return { success: false, error: `Track ${trackId} not found in movie.` }
      const result = await extractMkvSubtitleTrack(mkvPath, track)
      return { success: true, data: result }
    } catch (err: unknown) {
      const code = (err as Error & { code?: string }).code
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message, data: code === 'IMAGE_SUBTITLE' ? { imageSubtitle: true } : undefined }
    }
  })

  // ─── Translation ─────────────────────────────────────────────────────

  ipcMain.on(IPC_CHANNELS.START_TRANSLATION, async (_event, entries: SubtitleEntry[], settings: ApiSettings, jobId: string) => {
    const window = getWindow()
    const controller = new AbortController()
    jobs.set(jobId, controller)

    try {
      const results = await translateAll({
        entries,
        settings,
        signal: controller.signal,
        onProgress: (progress) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.TRANSLATION_PROGRESS, { ...progress, jobId })
          }
        }
      })

      jobs.delete(jobId)
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, { success: true, data: results, jobId })
      }
    } catch (err: unknown) {
      jobs.delete(jobId)
      // A partially-complete job carries the chunks that DID translate, so the
      // user keeps that work but is clearly told the rest is untranslated.
      const incomplete = err instanceof TranslationIncompleteError ? err : null
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          jobId,
          ...(incomplete
            ? {
                partialData: incomplete.partial,
                failedChunks: incomplete.failedChunks,
                totalChunks: incomplete.totalChunks
              }
            : {})
        })
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_TRANSLATION, async (_event, jobId: string): Promise<IpcResponse> => {
    try {
      if (jobId) {
        jobs.get(jobId)?.abort()
        jobs.delete(jobId)
      } else {
        for (const controller of jobs.values()) controller.abort()
        jobs.clear()
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}