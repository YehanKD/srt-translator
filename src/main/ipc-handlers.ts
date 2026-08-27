import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import type { SubtitleEntry, ApiSettings, IpcResponse } from '@shared/types'
import { importSrtFile, exportSrtFile, selectMkvFile } from './modules/file-io'
import { parseSrt, serializeSrt } from './modules/srt-parser'
import { fetchModels } from './modules/api-client'
import { translateAll } from './modules/translation-engine'
import { getMkvSubtitleTracks, extractMkvSubtitleTrack } from './modules/mkv-extract'

// One AbortController per translation job (keyed by tab id) so multiple
// subtitles can translate concurrently in separate tabs, each cancellable.
const jobs = new Map<string, AbortController>()

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
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
        const tracks = await getMkvSubtitleTracks(mkvPath)
        return { success: true, data: tracks }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })

    ipcMain.handle(IPC_CHANNELS.EXTRACT_MKV_TRACK, async (_event, mkvPath: string, trackId: number): Promise<IpcResponse> => {
      try {
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

    ipcMain.handle(IPC_CHANNELS.FETCH_MODELS, async (_event, endpointUrl: string, apiKey: string): Promise<IpcResponse> => {
    try {
      const models = await fetchModels(endpointUrl, apiKey)
      return { success: true, data: models }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Use 'on' instead of 'handle' for translation to avoid IPC race condition.
  // Each job is independent (own entries, own AbortController, tagged with jobId)
  // so N tabs can translate at once — the engine never shares mutable state
  // across jobs, and per-chunk ordering is preserved within each job.
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
          if (!window?.isDestroyed()) {
            window?.webContents.send(IPC_CHANNELS.TRANSLATION_PROGRESS, { ...progress, jobId })
          }
        }
      })

      jobs.delete(jobId)
      if (!window?.isDestroyed()) {
        window?.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, { success: true, data: results, jobId })
      }
    } catch (err: unknown) {
      jobs.delete(jobId)
      if (!window?.isDestroyed()) {
        window?.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          jobId
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
        // Backwards-compatible catch-all: abort everything.
        for (const controller of jobs.values()) controller.abort()
        jobs.clear()
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
