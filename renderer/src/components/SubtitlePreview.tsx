import { useState } from 'react'
import type { SubtitleEntry } from '@shared/types'
import { Modal, ModalHeader } from './Modal'
import { IconFile, IconChevronDown, IconEyeOff } from './Icons'

interface Props {
  source: SubtitleEntry[]
  translated: SubtitleEntry[] | null
  fileName: string
  isTranslating: boolean
  /** Anti-spoiler: blurs both text columns so you can't read ahead. */
  blurred?: boolean
  /** When set, some chunks failed — the result is not complete. */
  incomplete?: { failedChunks: number[]; totalChunks: number } | null
  /** Honest cue-level progress from the engine. */
  translatedCues?: number
  totalCues?: number
}

const BLUR = 'blur-[4px] select-none'

/** Cue text can contain newlines; render them as real line breaks. */
function CueText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap">{text}</span>
}

/**
 * The subtitle card. A real data table: alternating rows, monospaced timecodes,
 * and a sticky column header. Rows are 46px so roughly ten cues are readable at
 * a glance without the table becoming a wall.
 */
export function SubtitlePreview({
  source,
  translated,
  fileName,
  isTranslating,
  blurred,
  incomplete,
  translatedCues,
  totalCues
}: Props) {
  const [expanded, setExpanded] = useState(false)

  const translatedCount = translated?.length ?? 0
  const isComplete = translatedCount >= source.length && !isTranslating && !incomplete
  const showSinhala = translatedCount > 0

  // The honest cue counter. `translated.length` is unusable here: the engine
  // pads untranslated chunks with their originals so the table always has
  // full-length data, which made it read 491/491 from the first event.
  const cuesDone = translatedCues ?? 0
  const cuesTotal = totalCues ?? source.length
  const showCounter = isTranslating || (cuesDone > 0 && cuesDone < cuesTotal)

  const rows = isComplete && translated ? translated : source
  const previewRows = expanded ? rows : rows.slice(0, 10)
  const hiddenCount = rows.length - previewRows.length

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* ── File header: 50px ── */}
      <div className="flex h-[50px] items-center justify-between gap-3 border-b border-border bg-surface-alt px-6">
        <div className="flex min-w-0 items-center gap-2">
          <IconFile size={14} className="shrink-0 text-teal-text" />
          <span className="truncate text-base font-semibold text-text" title={fileName}>
            {fileName || 'Untitled'}
          </span>
          {/* Anti-spoiler state. An icon rather than a badge: the amber pill was
              the only yellow in the app and read as off-palette against the
              teal/slate system. Shown only while blurred, so the header stays
              quiet in the normal case. */}
          {blurred && (
            <span
              className="shrink-0 text-text-muted"
              title="Preview is blurred so you can't read ahead"
              aria-label="Preview is blurred"
            >
              <IconEyeOff size={15} />
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showCounter && (
            <span className="chip chip-accent nums" title="Cues translated">
              {cuesDone}/{cuesTotal}
            </span>
          )}
          {incomplete && (
            <span className="chip chip-danger">
              {incomplete.failedChunks.length}/{incomplete.totalChunks} chunks failed
            </span>
          )}
          {isComplete && <span className="chip chip-success">Translated</span>}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="max-h-[26rem] overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-alt">
              <th className="w-[60px] px-6 py-3 text-left text-sm font-bold uppercase tracking-wide text-text-muted">
                #
              </th>
              <th className="w-[180px] px-6 py-3 text-left text-sm font-bold uppercase tracking-wide text-text-muted">
                Time Window
              </th>
              <th className="px-6 py-3 text-left text-sm font-bold uppercase tracking-wide text-text-muted">
                Source
              </th>
              {showSinhala && (
                <th className="px-6 py-3 text-left text-sm font-bold uppercase tracking-wide text-text-muted">
                  Sinhala
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {previewRows.map((entry, i) => {
              const t = translated?.[i]
              const hasSinhala = Boolean(t && i < translatedCount && t.text !== entry.text)
              const english = isComplete && translated ? source[i]?.text ?? entry.text : entry.text
              const even = i % 2 === 1

              return (
                <tr
                  key={i}
                  className={`border-b border-border align-middle last:border-b-0 ${
                    even ? 'bg-surface-alt' : 'bg-surface'
                  }`}
                >
                  <td className="nums px-6 py-[14px] text-base text-text-muted">{i + 1}</td>
                  <td className="nums whitespace-nowrap px-6 py-[14px] font-mono text-base font-medium text-text-body">
                    {entry.startTime}
                  </td>
                  <td className={`px-6 py-[14px] text-base text-text-body ${blurred ? BLUR : ''}`}>
                    <CueText text={english} />
                  </td>
                  {showSinhala && (
                    <td
                      className={`px-6 py-[14px] text-base ${
                        hasSinhala ? 'text-text' : 'text-text-muted'
                      } ${blurred ? BLUR : ''}`}
                    >
                      {hasSinhala ? <CueText text={t!.text} /> : '—'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      {(hiddenCount > 0 || (expanded && rows.length > 10)) && (
        <div className="border-t border-border bg-surface py-4 text-center">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-2 text-sm font-bold text-teal-text transition-opacity hover:opacity-80"
          >
            {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            <IconChevronDown
              size={14}
              className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      )}
    </div>
  )
}

/** Full-screen cue viewer, for reading a long file without the table chrome. */
export function SubtitlePreviewModal({
  entries,
  fileName,
  onClose
}: {
  entries: SubtitleEntry[]
  fileName: string
  onClose: () => void
}) {
  return (
    <Modal onClose={onClose} width={38}>
      <ModalHeader title={fileName} subtitle={`${entries.length} cues`} onClose={onClose} />
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
        {entries.map((e, i) => (
          <div key={i} className="flex gap-3">
            <span className="nums w-24 shrink-0 pt-0.5 font-mono text-base text-text-muted">
              {e.startTime}
            </span>
            <p className="flex-1 text-base leading-relaxed text-text-body">
              <CueText text={e.text} />
            </p>
          </div>
        ))}
      </div>
    </Modal>
  )
}
