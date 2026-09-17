import { useState, useEffect, useCallback, useRef } from 'react'
import type { SubtitleEntry, ApiSettings, TranslationProgress, TranslationComplete } from '@shared/types'

export interface OverallProgress {
  completedChunks: number
  totalChunks: number
  status: 'sending' | 'received' | 'error' | 'done'
  activeChunks: number
  errorMessage?: string
}

/** Set when a job finished with some chunks permanently failed. */
export interface IncompleteInfo {
  failedChunks: number[]
  totalChunks: number
}

/**
 * Per-tab translation hook. `jobId` (the tab id) places each hook instance on
 * one job: progress/complete events are filtered by jobId, and cancel aborts
 * only this job — so multiple tabs can translate concurrently.
 */
export function useTranslation(jobId: string) {
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState<OverallProgress | null>(null)
  const [translatedEntries, setTranslatedEntries] = useState<SubtitleEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [incomplete, setIncomplete] = useState<IncompleteInfo | null>(null)
  const cleanupRefs = useRef<(() => void)[]>([])
  const completedChunksRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    return () => { cleanupRefs.current.forEach(fn => fn()) }
  }, [])

  const startTranslation = useCallback(async (entries: SubtitleEntry[], settings: ApiSettings) => {
    setTranslating(true)
    setProgress(null)
    setTranslatedEntries(null)
    setError(null)
    setIncomplete(null)
    completedChunksRef.current = new Set()

    // Clean up any previous listeners
    cleanupRefs.current.forEach(fn => fn())
    cleanupRefs.current = []

    // Register progress listener (only events for THIS job)
    const offProgress = window.electronAPI.onTranslationProgress((p: TranslationProgress) => {
      if (p.jobId !== jobId) return
      if (p.status === 'received' || p.status === 'error') {
        completedChunksRef.current.add(p.chunkIndex)
      }

      setProgress({
        completedChunks: completedChunksRef.current.size,
        totalChunks: p.totalChunks,
        status: p.status,
        activeChunks: p.activeChunks ?? (p.status === 'sending' ? 1 : 0),
        errorMessage: p.errorMessage
      })

      if (p.status === 'received' && p.partialResult && p.partialResult.length > 0) {
        setTranslatedEntries(p.partialResult)
      }
    })
    cleanupRefs.current.push(offProgress)

    // Register completion listener
    const offComplete = window.electronAPI.onTranslationComplete((result: TranslationComplete) => {
      if (result.jobId !== jobId) return
      if (result.success && result.data) {
        setTranslatedEntries(result.data)
        // Mark progress as done so the progress bar shows "Translation
        // Complete" instead of being stuck on "Translating..." (the last
        // chunk event leaves status='received').
        setProgress((prev) => ({
          completedChunks: prev?.totalChunks ?? 1,
          totalChunks: prev?.totalChunks ?? 1,
          status: 'done',
          activeChunks: 0
        }))
      } else {
        setError(result.error || 'Translation failed')
        // Some chunks succeeded before others gave up: keep the translated work
        // visible so it can still be exported, and flag that it is incomplete.
        if (result.partialData) {
          setTranslatedEntries(result.partialData)
          setIncomplete({
            failedChunks: result.failedChunks ?? [],
            totalChunks: result.totalChunks ?? 0
          })
        }
      }
      setTranslating(false)
      cleanupRefs.current.forEach(fn => fn())
      cleanupRefs.current = []
    })
    cleanupRefs.current.push(offComplete)

    // Send translation request (fire-and-forget) tagged with this job id
    window.electronAPI.startTranslation(entries, settings, jobId)
  }, [jobId])

  const cancelTranslation = useCallback(async () => {
    await window.electronAPI.cancelTranslation(jobId)
  }, [jobId])

  const reset = useCallback(() => {
    setTranslatedEntries(null)
    setProgress(null)
    setError(null)
    setIncomplete(null)
  }, [])

  return {
    translating,
    progress,
    translatedEntries,
    error,
    incomplete,
    startTranslation,
    cancelTranslation,
    reset
  }
}