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

// A subtitle whose whole text is a bracketed sound/background cue — e.g.
// "(ALARM BLARING)", "[GUARDS YELLING]" — is not dialogue, so we drop it.
const SOUND_CUE_RE = /^\s*(?:\([\s\S]*?\)|\[[\s\S]*?\])\s*$/

// Optional ALL-CAPS speaker tag, e.g. "CHOW:", "ALAN:", "WOMAN 1:",
// "MILLER (V.O.):", "BILLY JOEL (SINGING...):". Matches both at the start of a
// line and inline mid-line ("- Pensive? ALAN: - Yeah."). Kept to uppercase so
// normal dialogue (which is Title Case) doesn't get clipped.
const SPEAKER_RE = /(?<=^|\s)(?:-\s*)?[A-Z][A-Z0-9 .'&#()\-]{1,50}?:/g

// Strip speaker-name tags (leading or inline). Lines left empty (a bare
// "CHOW:" with nothing after) are dropped, then everything is re-numbered.
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

// Anti-spoiler preference: new tabs start with the preview blurred (default
// on). It's a persistent default too — restore on ("true") so it stays
// blurred across restarts regardless of any per-tab reveal.
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
  // Per-tab anti-spoiler state. Defaults from the persisted preference; each
  // tab can be revealed independently while the others stay blurred.
  const [blurred, setBlurred] = useState<boolean>(loadBlurDefault)

  const { translating, progress, translatedEntries, error, startTranslation, cancelTranslation, reset } =
    useTranslation(tabId)

  const percent = progress
    ? Math.round((progress.completedChunks / progress.totalChunks) * 100)
    : null

  // What actually gets previewed + translated: the working set, minus speaker
  // tags when the checkbox is on. Kept separate from sourceEntries so toggling
  // stays reversible.
  const effectiveEntries = useMemo(
    () => (removeSpeakerNames && sourceEntries ? stripSpeakerNames(sourceEntries) : sourceEntries),
    [sourceEntries, removeSpeakerNames]
  )

  // Report this tab's title/status up so the tab bar can show spinners + %.
  useEffect(() => {
    onTabInfoChange(tabId, {
      title: sourceFileName || defaultTitle,
      translating,
      percent,
      subtitleCount: effectiveEntries?.length ?? 0
    })
  }, [tabId, sourceFileName, defaultTitle, translating, percent, effectiveEntries, onTabInfoChange])

  // Consume externally-provided subtitles (MKV extraction / home drop). The
  // effect re-runs whenever a NEW initialImport object arrives, so content can
  // be loaded into an already-mounted tab (e.g. a home tab turning workspace).
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

  // Toggle speaker-name stripping; any existing translation is stale afterwards.
  const toggleSpeakerNames = useCallback(() => {
    setRemoveSpeakerNames((v) => !v)
    reset()
  }, [reset])

  // Drop non-dialogue sound/background cues ((…) or […]) and re-number.
  const handleRemoveSoundLines = useCallback(() => {
    if (!sourceEntries) return
    const kept = sourceEntries.filter((e) => !SOUND_CUE_RE.test(e.text))
    const removed = sourceEntries.length - kept.length
    setRemovedSoundCount((prev) => prev + removed)
    setSourceEntries(kept.map((e, i) => ({ ...e, id: String(i + 1) })))
    reset()
  }, [sourceEntries, reset])

  const canTranslate = sourceEntries && settings.endpointUrl && settings.modelId && !translating

  return (
    <div className={isActive ? 'space-y-4' : 'hidden'}>
      {sourceEntries && (
        <div className="flex gap-2">
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
        />
      )}

      <TranslationProgress progress={progress} onCancel={cancelTranslation} error={error} />

      {translatedEntries && <ExportButton entries={translatedEntries} sourceFileName={sourceFileName} />}
    </div>
  )
}
