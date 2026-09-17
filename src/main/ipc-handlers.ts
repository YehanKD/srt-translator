import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type { SubtitleEntry, ApiSettings, IpcResponse, AuthProgress, AccountStatus, QuotaSummary } from '@shared/types'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { pickInputFile, readSrtFile, exportSrtFile, selectMkvFile } from './modules/file-io'
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
import { loadCodeAssist, onboardUser, fetchUserInfo, discoverAccount } from './modules/antigravity/bootstrap'
import { fetchQuota } from './modules/antigravity/quota'
import { pickChatModels, ANTIGRAVITY_PUBLIC_MODELS, ANTIGRAVITY_DEFAULT_MODEL_ID } from './modules/antigravity/catalog'

const jobs = new Map<string, AbortController>()
let authListener: ReturnType<typeof startOAuthListener> | null = null
let authTimeout: NodeJS.Timeout | null = null

/**
 * Turn a thrown error into something a person can act on.
 *
 * Raw `err.message` leaks Node internals straight into the UI — an empty-path
 * drop surfaced as "ENOENT: no such file or directory, open ''". Users can't
 * act on that, and it makes the app look broken. Map the cases that actually
 * happen to plain language; keep the original for the console.
 */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const code = (err as NodeJS.ErrnoException)?.code

  if (code === 'ENOENT' || /ENOENT/.test(raw)) {
    return 'That file could not be found. It may have been moved, renamed, or deleted.'
  }
  if (code === 'EACCES' || code === 'EPERM' || /EACCES|EPERM/.test(raw)) {
    return 'Permission denied. Try a different location, or run the app with more access.'
  }
  if (code === 'EISDIR' || /EISDIR/.test(raw)) {
    return 'That is a folder, not a file. Pick a subtitle file instead.'
  }
  if (code === 'ENOSPC' || /ENOSPC/.test(raw)) {
    return 'There is no space left on the disk.'
  }
  if (/Unexpected end of|Invalid SRT|missing timecode|no cues/i.test(raw)) {
    return 'That subtitle file could not be read. It may be corrupted or not a valid .srt.'
  }
  if (/aborted|AbortError/i.test(raw)) {
    return 'Cancelled.'
  }

  console.error('[srt-translator] unhandled error:', err)
  return raw || 'Something went wrong. Please try again.'
}

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

      // Discover the Cloud Code project. A missing project must NOT fail the
      // sign-in: Google does not assign one to every account, and it can
      // appear later (discovery is retried per request). Failing here threw
      // away a valid refresh token and forced a fresh consent screen for
      // something the user cannot fix by signing in again.
      let discovery = await discoverAccount(tokens.accessToken)

      if (!discovery.projectId) {
        emitAuthProgress(window, {
          phase: 'onboarding',
          message: 'Setting up this account (first-time)…'
        })
        // Onboard with the account's REAL tier, falling back to legacy-tier.
        const onboarded = await onboardUser(
          tokens.accessToken,
          discovery.tierId ?? 'legacy-tier'
        )
        if (onboarded?.projectId) {
          // Re-read so the tier/plan come from a normal discovery response.
          const after = await discoverAccount(tokens.accessToken)
          discovery = {
            ...after,
            projectId: after.projectId ?? onboarded.projectId,
            tierId: after.tierId ?? onboarded.tierId,
            plan: after.plan !== 'Free' ? after.plan : onboarded.plan
          }
        }
      }

      const session = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        email: userInfo.email,
        picture: userInfo.picture,
        plan: discovery.plan,
        projectId: discovery.projectId,
        tierId: discovery.tierId,
        connectedAt: Date.now()
      }

      setSession(session)
      emitAuthProgress(window, {
        phase: 'complete',
        message: discovery.projectId
          ? 'Signed in successfully'
          : 'Signed in — this account has no Cloud Code project yet'
      })
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
      const errorMsg = friendlyError(err)
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
      return { success: false, error: friendlyError(err) }
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
      const picked = await pickInputFile()
      if (!picked) return { success: true, data: null }

      // A movie isn't parsed here — hand the path back so the renderer opens
      // its track picker, which is the only meaningful next step for an .mkv.
      if (picked.kind === 'mkv') {
        return {
          success: true,
          data: { kind: 'mkv', mkvPath: picked.filePath, fileName: picked.fileName }
        }
      }

      const content = await readSrtFile(picked.filePath)
      const entries = parseSrt(content)
      return {
        success: true,
        data: {
          kind: 'srt',
          fileName: picked.fileName,
          result: { filePath: picked.filePath, fileName: picked.fileName, entries }
        }
      }
    } catch (err: unknown) {
      return { success: false, error: friendlyError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.EXPORT_SRT, async (_event, entries: SubtitleEntry[], suggestedName: string): Promise<IpcResponse> => {
    try {
      const content = serializeSrt(entries)
      const savedPath = await exportSrtFile(content, suggestedName)
      return { success: true, data: savedPath }
    } catch (err: unknown) {
      return { success: false, error: friendlyError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.IMPORT_SRT_PATH, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      const content = await readFile(filePath, 'utf-8')
      const entries = parseSrt(content)
      return { success: true, data: { filePath, fileName: basename(filePath), entries } }
    } catch (err: unknown) {
      return { success: false, error: friendlyError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SELECT_MKV, async (): Promise<IpcResponse> => {
    try {
      const path = await selectMkvFile()
      return { success: true, data: path }
    } catch (err: unknown) {
      return { success: false, error: friendlyError(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.LIST_MKV_TRACKS, async (_event, mkvPath: string): Promise<IpcResponse> => {
    try {
      const { getMkvSubtitleTracks } = await import('./modules/mkv-extract')
      const tracks = await getMkvSubtitleTracks(mkvPath)
      return { success: true, data: tracks }
    } catch (err: unknown) {
      return { success: false, error: friendlyError(err) }
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
      const message = friendlyError(err)
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

      // A cancel is a deliberate user action, not a failure. The engine signals
      // it by throwing AbortError; without this branch it fell into the generic
      // error path and the UI reported "Failed" for something the user chose.
      // Accept either signal: `name` is the convention, but checking the
      // message too means an abort can never be misreported as a failure.
      const aborted =
        err instanceof Error &&
        (err.name === 'AbortError' || /\bAbortError\b|cancelled/i.test(err.message))
      if (aborted) {
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, {
            success: false,
            cancelled: true,
            jobId
          })
        }
        return
      }

      // A partially-complete job carries the chunks that DID translate, so the
      // user keeps that work but is clearly told the rest is untranslated.
      const incomplete = err instanceof TranslationIncompleteError ? err : null
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, {
          success: false,
          error: friendlyError(err),
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
      return { success: false, error: friendlyError(err) }
    }
  })
}