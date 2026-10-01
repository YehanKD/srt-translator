import { useEffect, useState } from 'react'
import type { SubtitleEntry } from '@shared/types'
import type { OverallProgress } from '../hooks/useTranslation'

interface Props {
  progress: OverallProgress | null
  error: string | null
  /** Set when some chunks failed permanently — the result is NOT complete. */
  incomplete?: { failedChunks: number[]; totalChunks: number } | null
  /** True when the user stopped the job themselves — not a failure. */
  cancelled?: boolean
  /** Translated cues, once there are any to export. */
  entries: SubtitleEntry[] | null
  sourceFileName: string
  /**
   * Folder the source movie lives in. When set, the save dialog opens there so
   * the exported subtitle lands beside the movie — which is what lets the
   * player auto-load it (players match by filename within the same directory).
   */
  sourceDir?: string
  onCancel: () => void
}

type Tone = 'working' | 'done' | 'incomplete' | 'error' | 'cancelled'
type SaveState = 'idle' | 'saving' | 'saved'

/**
 * The job strip — one element that morphs through the whole lifecycle instead of
 * two stacked cards.
 *
 * WHY MERGED: the previous design showed a progress card AND a separate export
 * card at the same time. That meant the export card could claim "403 cues ready"
 * while only 8 of 27 chunks were done — the cues were mid-translation, not
 * ready. Two elements describing the same job will always disagree at some
 * moment; one element cannot.
 *
 * States, in order of precedence:
 *   working    — spinner + "Translating" + progress bar + Cancel
 *   done       — "N cues ready" + destination + Export
 *   incomplete — warning + "Export anyway"
 *   error      — message + Cancel/retry
 *
 * Deliberately NOT shown: chunk counts and in-flight concurrency. Those are
 * implementation detail; the bar already answers "is it advancing?".
 *
 * Motion: the label swap uses a 2px blur bridge, because two labels crossfading
 * without blur reads as two words overlapping rather than one changing. The
 * meter uses linear timing — it's constant motion, where linear is correct.
 */
export function JobStrip({ progress, error, incomplete, cancelled, entries, sourceFileName, sourceDir, onCancel }: Props) {
  const [save, setSave] = useState<SaveState>('idle')
  const [savedPath, setSavedPath] = useState<string | null>(null)

  // Reset the confirmation after a beat so the button returns to its resting
  // state.
  useEffect(() => {
    if (save !== 'saved') return
    const t = setTimeout(() => setSave('idle'), 2600)
    return () => clearTimeout(t)
  }, [save])

  const hasEntries = Boolean(entries && entries.length > 0)
  // The job is in flight for both 'sending' (request out) and 'received'
  // (chunks streaming back) — only 'done'/'error' are settled.
  const translating =
    (progress?.status === 'sending' || progress?.status === 'received') && !error && !incomplete

  // Nothing to report and nothing to export.
  if (!progress && !error && !hasEntries) return null

  const tone: Tone = cancelled
    ? 'cancelled'
    : incomplete
      ? 'incomplete'
      : error || progress?.status === 'error'
        ? 'error'
        : translating
          ? 'working'
          : 'done'

  const total = progress?.totalChunks ?? 0
  const done = progress?.completedChunks ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  // Export name.
  //
  // When the source came from an MKV, the subtitle must be named EXACTLY after
  // the movie ("Movie.mkv" -> "Movie.srt") so players auto-load it. Any suffix
  // in between breaks that, so no ".si" is added here.
  //
  // For a plain .srt import there is no movie to match, and dropping the suffix
  // would suggest overwriting the user's own source file — so the ".si" marker
  // stays to keep the translation distinct.
  const suggestedName = sourceDir
    ? sourceFileName
    : sourceFileName.replace(/\.srt$/i, '.si.srt')

  const meta: Record<Tone, { label: string; color: string; chip: string }> = {
    working: { label: 'Translating', color: 'var(--t-teal)', chip: 'chip-accent' },
    done: { label: 'Complete', color: 'var(--t-teal)', chip: 'chip-success' },
    incomplete: { label: 'Incomplete', color: 'var(--t-warn-text)', chip: 'chip-warning' },
    error: { label: 'Failed', color: 'var(--t-danger)', chip: 'chip-danger' },
    // A cancel is a deliberate stop, so it reads as neutral rather than alarming.
    cancelled: { label: 'Cancelled', color: 'var(--t-text-muted)', chip: '' }
  }
  const m = meta[tone]

  const message =
    tone === 'cancelled'
      ? 'Stopped before finishing. The cues translated so far are kept.'
      : error ||
        progress?.errorMessage ||
        (tone === 'incomplete' && incomplete
          ? `${incomplete.failedChunks.length} of ${incomplete.totalChunks} chunks failed after every retry. Those lines are still in the original language.`
          : null)

  const handleExport = async () => {
    if (!entries) return
    setSave('saving')
    setSavedPath(null)
    try {
      const result = await window.electronAPI.exportSrt(entries, suggestedName, sourceDir)
      if (result.success && result.data) {
        setSavedPath(result.data)
        setSave('saved')
      } else {
        setSave('idle')
      }
    } catch {
      setSave('idle')
    }
  }

  const exportLabel =
    save === 'saving'
      ? 'Saving…'
      : save === 'saved'
        ? 'Saved'
        : tone === 'incomplete'
          ? 'Export anyway'
          : 'Export .srt'

  // The bar shows while working and on completion (a full bar reads as "done"),
  // so the strip's height stays stable through the job.
  const showMeter = (tone === 'working' || tone === 'done') && total > 0

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Spinner while working; a quiet dot for every settled state. */}
        {tone === 'working' ? (
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.75px] border-t-transparent"
            style={{ borderColor: m.color, borderTopColor: 'transparent' }}
            aria-hidden="true"
          />
        ) : (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: m.color }}
            aria-hidden="true"
          />
        )}

        <span className={`chip ${m.chip} shrink-0`}>{m.label}</span>

        {/* Centre: what's ready to save. While working this stays empty — the
            spinner and the chip already say "Translating", and a third grey
            line saying the same thing was noise. */}
        <span className="min-w-0 flex-1">
          {tone === 'working' ? null : hasEntries ? (
            <span className="block truncate text-base text-text">
              <span className="nums font-semibold">{entries!.length}</span> cues ready
              {savedPath ? (
                <span className="ml-2 text-micro text-teal-text">Saved to {savedPath}</span>
              ) : (
                <span className="ml-2 text-micro text-text-muted">Will save as {suggestedName}</span>
              )}
            </span>
          ) : (
            <span className="block truncate text-base text-text-body">
              {message ?? 'Nothing to export'}
            </span>
          )}
        </span>

        {/* Right: Cancel while working, Export once there's something to save. */}
        {tone === 'working' && (
          <button onClick={onCancel} className="btn btn-ghost shrink-0">
            Cancel
          </button>
        )}

        {tone !== 'working' && hasEntries && (
          <button
            onClick={handleExport}
            disabled={save === 'saving'}
            className={`btn shrink-0 ${tone === 'incomplete' ? 'btn-danger' : 'btn-primary'}`}
          >
            {/* blur bridges the label swap so it doesn't read as two words overlapping */}
            <span
              className="transition-[filter,opacity] duration-200"
              style={{
                filter: save === 'saving' ? 'blur(2px)' : 'none',
                opacity: save === 'saving' ? 0.7 : 1
              }}
            >
              {exportLabel}
            </span>
          </button>
        )}
      </div>

      {showMeter && (
        <div className="meter mt-2.5">
          <div
            className="meter-fill"
            style={{ width: `${percent}%`, background: 'var(--t-teal)' }}
          />
        </div>
      )}

      {/* Only the failure states need a second line. */}
      {(tone === 'error' || tone === 'incomplete' || tone === 'cancelled') && message && (
        <p
          className="mt-2 text-micro leading-relaxed"
          style={{
            color:
              tone === 'error'
                ? 'var(--t-danger)'
                : tone === 'cancelled'
                  ? 'var(--t-text-muted)'
                  : 'var(--t-warn-text)'
          }}
        >
          {message}
        </p>
      )}
    </div>
  )
}
