import { useState, useEffect, useCallback } from 'react'
import { FileImport } from './FileImport'
import { SubtitlePreview } from './SubtitlePreview'
import { Switch } from './Switch'
import { JobStrip } from './JobStrip'
import { useTranslation } from '../hooks/useTranslation'
import { IconGlobe, IconFilePlus } from './Icons'
import { cleanupSubtitles } from '../lib/subtitle-cleanup'
import type { SubtitleEntry, ApiSettings } from '@shared/types'

export interface TabViewInfo {
  title: string
  translating: boolean
  percent: number | null
}

interface Props {
  tabId: string
  defaultTitle: string
  settings: ApiSettings
  isActive: boolean
  initialImport?: { entries: SubtitleEntry[]; fileName: string; sourceDir?: string } | null
  onInitialConsumed?: (tabId: string) => void
  onMkvDropped?: (mkvPath: string) => void
  onTabInfoChange: (tabId: string, info: TabViewInfo) => void
}

const BLUR_PREF_KEY = 'srt-translator-blur-default'
function loadBlurDefault(): boolean {
  try {
    const v = localStorage.getItem(BLUR_PREF_KEY)
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

export function TabView({ tabId, defaultTitle, settings, isActive, initialImport, onInitialConsumed, onMkvDropped, onTabInfoChange }: Props) {
  const [sourceEntries, setSourceEntries] = useState<SubtitleEntry[] | null>(null)
  const [sourceFileName, setSourceFileName] = useState('')
  /** Folder of the source movie, so the export can default beside it. */
  const [sourceDir, setSourceDir] = useState<string | undefined>(undefined)
  const [blurred, setBlurred] = useState<boolean>(loadBlurDefault)

  const { translating, progress, translatedEntries, error, incomplete, cancelled, startTranslation, cancelTranslation, reset } =
    useTranslation(tabId)

  const percent = progress
    ? Math.round((progress.completedChunks / progress.totalChunks) * 100)
    : null

  const effectiveEntries = sourceEntries

  useEffect(() => {
    onTabInfoChange(tabId, {
      title: sourceFileName || defaultTitle,
      translating,
      percent
    })
  }, [tabId, sourceFileName, defaultTitle, translating, percent, effectiveEntries, onTabInfoChange])

  useEffect(() => {
    if (!initialImport) return
    // Clean on import so the preview shows exactly what will be translated —
    // sound descriptions, song lyrics, speaker labels and formatting markup all
    // cost quota and come back as nonsense if they reach the model. Nothing is
    // reported to the user: the preview simply shows the cleaned result.
    const { entries } = cleanupSubtitles(initialImport.entries)
    setSourceEntries(entries)
    setSourceFileName(initialImport.fileName)
    setSourceDir(initialImport.sourceDir)
    reset()
    onInitialConsumed?.(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImport])

  const handleImport = useCallback((entries: SubtitleEntry[], fileName: string) => {
    const { entries: cleaned } = cleanupSubtitles(entries)
    setSourceEntries(cleaned)
    setSourceFileName(fileName)
    setSourceDir(undefined)
    reset()
  }, [reset])

  const handleNewFile = useCallback(() => {
    setSourceEntries(null)
    setSourceFileName('')
    setSourceDir(undefined)
    reset()
  }, [reset])

  const handleTranslate = useCallback(() => {
    if (!effectiveEntries || !settings.modelId) return
    startTranslation(effectiveEntries, settings)
  }, [effectiveEntries, settings, startTranslation])

  const canTranslate = Boolean(sourceEntries && settings.modelId && !translating)

  return (
    <div className={isActive ? 'flex h-full flex-col' : 'hidden'}>
      {/* ── Workspace controls: actions left, view toggles right. ── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-8 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleTranslate}
            disabled={!canTranslate}
            className="btn btn-primary"
          >
            <IconGlobe size={16} />
            {translating ? 'Translating…' : 'Translate File'}
          </button>

          <button onClick={handleNewFile} disabled={translating} className="btn btn-secondary">
            <IconFilePlus size={16} />
            New File
          </button>
        </div>

        <div className="flex items-center gap-6">
          {/* Deliberately NOT disabled while translating: blur is a view
              setting, so it stays live throughout the job. */}
          <Switch
            checked={blurred}
            onChange={setBlurred}
            label="Blur preview"
            title="Hide the source and Sinhala text so you can't read ahead"
          />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-8 pb-6">
        <div className="space-y-3">
          {!sourceEntries && (
            <FileImport onImport={handleImport} onMkvDropped={onMkvDropped} disabled={translating} />
          )}

          {sourceEntries && (
            <SubtitlePreview
              source={effectiveEntries ?? []}
              translated={translatedEntries}
              fileName={sourceFileName}
              isTranslating={translating}
              blurred={blurred}
              incomplete={incomplete}
              translatedCues={progress?.translatedCues}
              totalCues={progress?.totalCues}
            />
          )}

          {/* One strip for the whole job lifecycle: progress while working,
              then the export action when there's something to save. */}
          <JobStrip
            progress={progress}
            error={error}
            incomplete={incomplete}
            cancelled={cancelled}
            entries={translatedEntries}
            sourceFileName={sourceFileName}
            sourceDir={sourceDir}
            onCancel={cancelTranslation}
          />
        </div>
      </div>
    </div>
  )
}
