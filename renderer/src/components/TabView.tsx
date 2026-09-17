import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileImport } from './FileImport'
import { SubtitlePreview } from './SubtitlePreview'
import { TranslationProgress } from './TranslationProgress'
import { ExportButton } from './ExportButton'
import { useTranslation } from '../hooks/useTranslation'
import type { SubtitleEntry, ApiSettings } from '@shared/types'

export interface TabViewInfo {
  title: string
  translating: boolean
  percent: number | null
  subtitleCount: number
}

interface Props {
  tabId: string
  defaultTitle: string
  settings: ApiSettings
  isActive: boolean
  initialImport?: { entries: SubtitleEntry[]; fileName: string } | null
  onInitialConsumed?: (tabId: string) => void
  onMkvDropped?: (mkvPath: string) => void
  onTabInfoChange: (tabId: string, info: TabViewInfo) => void
}

const SOUND_CUE_RE = /^\s*(?:\([\s\S]*?\)|\[[\s\S]*?\])\s*$/
const SPEAKER_RE = /(?<=^|\s)(?:-\s*)?[A-Z][A-Z0-9 .'&#()\-]{1,50}?:/g

function stripSpeakerNames(entries: SubtitleEntry[]): SubtitleEntry[] {
  const kept: SubtitleEntry[] = []
  for (const e of entries) {
    const text = e.text
      .replace(SPEAKER_RE, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n +/g, '\n')
      .trim()
    if (!text) continue
    kept.push({ ...e, text })
  }
  return kept.map((e, i) => ({ ...e, id: String(i + 1) }))
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
  const [removedSoundCount, setRemovedSoundCount] = useState(0)
  const [removeSpeakerNames, setRemoveSpeakerNames] = useState(false)
  const [blurred, setBlurred] = useState<boolean>(loadBlurDefault)

  const { translating, progress, translatedEntries, error, incomplete, startTranslation, cancelTranslation, reset } =
    useTranslation(tabId)

  const percent = progress
    ? Math.round((progress.completedChunks / progress.totalChunks) * 100)
    : null

  const effectiveEntries = useMemo(
    () => (removeSpeakerNames && sourceEntries ? stripSpeakerNames(sourceEntries) : sourceEntries),
    [sourceEntries, removeSpeakerNames]
  )

  useEffect(() => {
    onTabInfoChange(tabId, {
      title: sourceFileName || defaultTitle,
      translating,
      percent,
      subtitleCount: effectiveEntries?.length ?? 0
    })
  }, [tabId, sourceFileName, defaultTitle, translating, percent, effectiveEntries, onTabInfoChange])

  useEffect(() => {
    if (!initialImport) return
    setSourceEntries(initialImport.entries)
    setSourceFileName(initialImport.fileName)
    setRemovedSoundCount(0)
    reset()
    onInitialConsumed?.(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImport])

  const handleImport = useCallback((entries: SubtitleEntry[], fileName: string) => {
    setSourceEntries(entries)
    setSourceFileName(fileName)
    setRemovedSoundCount(0)
    reset()
  }, [reset])

  const handleNewFile = useCallback(() => {
    setSourceEntries(null)
    setSourceFileName('')
    setRemovedSoundCount(0)
    reset()
  }, [reset])

  const handleTranslate = useCallback(() => {
    if (!effectiveEntries || !settings.modelId) return
    startTranslation(effectiveEntries, settings)
  }, [effectiveEntries, settings, startTranslation])

  const toggleSpeakerNames = useCallback(() => {
    setRemoveSpeakerNames((v) => !v)
    reset()
  }, [reset])

  const handleRemoveSoundLines = useCallback(() => {
    if (!sourceEntries) return
    const kept = sourceEntries.filter((e) => !SOUND_CUE_RE.test(e.text))
    const removed = sourceEntries.length - kept.length
    setRemovedSoundCount((prev) => prev + removed)
    setSourceEntries(kept.map((e, i) => ({ ...e, id: String(i + 1) })))
    reset()
  }, [sourceEntries, reset])

  const canTranslate = sourceEntries && settings.modelId && !translating

  return (
    <div className={isActive ? 'space-y-4' : 'hidden'}>
      {sourceEntries && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleTranslate}
            disabled={!canTranslate}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            {translating ? 'Translating...' : 'Translate'}
          </button>
          <button
            onClick={handleNewFile}
            disabled={translating}
            className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-sm font-medium py-2 px-4 rounded-lg border border-gray-700 transition-colors"
          >
            Import New File
          </button>
          <button
            onClick={handleRemoveSoundLines}
            disabled={translating || !canTranslate}
            title="Remove subtitles that are only background sounds, e.g. (ALARM BLARING) or [GUARDS YELLING]"
            className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-sm font-medium py-2 px-4 rounded-lg border border-gray-700 transition-colors"
          >
            Remove Sound Lines
          </button>
          <label
            className={`flex items-center gap-2 cursor-pointer select-none text-sm text-gray-300 ${
              translating ? 'opacity-50' : ''
            }`}
          >
            <button
              type="button"
              role="switch"
              aria-checked={removeSpeakerNames}
              onClick={toggleSpeakerNames}
              disabled={translating}
              title="Remove speaker names like CHOW: / ALAN:"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                removeSpeakerNames ? 'bg-amber-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  removeSpeakerNames ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            Remove Speaker Name
          </label>

          <label
            className={`flex items-center gap-2 cursor-pointer select-none text-sm text-gray-300 ${
              translating ? 'opacity-50' : ''
            }`}
          >
            <button
              type="button"
              role="switch"
              aria-checked={blurred}
              onClick={() => setBlurred(!blurred)}
              disabled={translating}
              title="Blur the English & Sinhala preview so you can't accidentally read ahead (anti-spoiler)"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                blurred ? 'bg-amber-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  blurred ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            Blur Preview
          </label>
        </div>
      )}

      {removedSoundCount > 0 && sourceEntries && (
        <p className="text-xs text-amber-400/90">
          Removed {removedSoundCount} background sound line{removedSoundCount === 1 ? '' : 's'} (non-dialogue cues). Translation will skip them.
        </p>
      )}

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
        />
      )}

      <TranslationProgress progress={progress} onCancel={cancelTranslation} error={error} incomplete={incomplete} />

      {translatedEntries && (
        <ExportButton entries={translatedEntries} sourceFileName={sourceFileName} incomplete={incomplete} />
      )}
    </div>
  )
}