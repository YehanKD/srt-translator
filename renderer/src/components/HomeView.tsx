import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubtitleEntry, MkvSubtitleTrack } from '@shared/types'
import { Modal, ModalHeader, ModalFooter } from './Modal'
import { IconMessageSquareText, IconUpload, IconAlert } from './Icons'

interface Props {
  onLoaded: (entries: SubtitleEntry[], fileName: string) => void
  initialMkvPath?: string | null
  onMkvPathConsumed?: () => void
}

type Phase = 'idle' | 'picking' | 'extracting'

/**
 * Start screen. One entry point: the drop zone is both a drop target AND the
 * browse button.
 *
 * Previously the zone advertised "or click to choose a file" but its click
 * handler only switched to the workspace, so the text was false and the user had
 * to click again there. The two alternative cards below (Open subtitle file /
 * Extract from movie) duplicated what the zone already does, so they're gone —
 * `pickInput()` classifies the chosen file and routes .srt vs .mkv by extension.
 */
export function HomeView({ onLoaded, initialMkvPath, onMkvPathConsumed }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [mkvPath, setMkvPath] = useState('')
  const [mkvName, setMkvName] = useState('')
  const [tracks, setTracks] = useState<MkvSubtitleTrack[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const dragDepth = useRef(0)

  const listTracksFor = useCallback(async (path: string) => {
    setError('')
    setMkvPath(path)
    setMkvName(path.split(/[\\/]/).pop() || path)
    setSelectedId(null)
    try {
      const res = await window.electronAPI.listMkvTracks(path)
      if (!res.success) {
        setError(res.error || 'Could not read the movie file.')
        setPhase('idle')
        return
      }
      const list = (res.data || []) as MkvSubtitleTrack[]
      setTracks(list)
      setPhase(list.length > 0 ? 'picking' : 'idle')
      if (list.length === 0) setError('No subtitle tracks found in this movie.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }, [])

  /** The zone's click action: open the picker and route by file kind. */
  const browse = useCallback(async () => {
    setError('')
    setBrowsing(true)
    try {
      const res = await window.electronAPI.pickInput()
      if (!res.success) {
        setError(res.error || 'Could not open that file.')
        return
      }
      const picked = res.data
      if (!picked) return // cancelled

      if (picked.kind === 'mkv') {
        void listTracksFor(picked.mkvPath!)
        return
      }
      if (picked.result) onLoaded(picked.result.entries, picked.result.fileName)
    } finally {
      setBrowsing(false)
    }
  }, [listTracksFor, onLoaded])

  const closePicker = useCallback(() => {
    setPhase('idle')
    setTracks([])
    setMkvPath('')
    setError('')
  }, [])

  // If the app handed us an MKV path (e.g. a drop made in the translator),
  // open its track picker right away.
  useEffect(() => {
    if (initialMkvPath) {
      void listTracksFor(initialMkvPath)
      onMkvPathConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMkvPath])

  const extractSelected = useCallback(async () => {
    if (selectedId == null || !mkvPath) return
    setPhase('extracting')
    setError('')
    try {
      const res = await window.electronAPI.extractMkvTrack(mkvPath, selectedId)
      if (res.success && res.data) {
        const r = res.data as { fileName: string; entries: SubtitleEntry[] }
        onLoaded(r.entries, r.fileName)
        return
      }
      setError(res.error || 'Extraction failed.')
      setPhase('picking')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('picking')
    }
  }, [selectedId, mkvPath, onLoaded])

  // ── Drag & drop over the whole surface ───────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), [])
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }, [])
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      const path = window.electronAPI.getPathForFile(file)
      const lower = (file.name || path).toLowerCase()
      if (lower.endsWith('.mkv')) {
        void listTracksFor(path)
      } else if (lower.endsWith('.srt')) {
        const res = await window.electronAPI.importSrtFromPath(path)
        if (res.success && res.data) onLoaded(res.data.entries, res.data.fileName)
        else setError(res.error || 'Could not read the .srt file.')
      } else {
        setError('That file type isn’t supported — drop an .srt subtitle or an .mkv movie.')
      }
    },
    [listTracksFor, onLoaded]
  )

  const languageLabel = (t: MkvSubtitleTrack) => {
    const lang = t.language && t.language !== 'und' ? t.language.toUpperCase() : 'Any language'
    return t.trackName ? `${lang} · ${t.trackName}` : lang
  }

  return (
    <div
      className="flex-1 overflow-y-auto"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      <div className="grid min-h-full place-items-center px-8 py-10">
        <div className="w-full max-w-[34rem]">
          {/* Identity — the only centred block; everything below is a control. */}
          <div className="flex flex-col items-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal text-white">
              <IconMessageSquareText size={24} />
            </span>
            <h1 className="mt-4 text-title font-bold text-text">Translate subtitles into Sinhala</h1>
            <p className="mt-2 max-w-[27rem] text-md leading-relaxed text-text-muted">
              Drop subtitles in any language. Get back Sinhala — timings, drama and all.
            </p>
          </div>

          {/* The one entry point: drop a file here, or click to browse. The
              click actually opens the picker now, so the label is truthful. */}
          <button
            onClick={() => void browse()}
            disabled={browsing}
            className={`mt-6 w-full rounded-xl px-6 py-7 text-center transition-colors duration-150 disabled:opacity-70 ${
              dragging
                ? 'border-2 border-dashed border-teal bg-teal-soft'
                : 'border border-dashed border-border-strong bg-surface hover:border-teal hover:bg-teal-soft'
            }`}
          >
            <span className={`grid place-items-center ${dragging ? 'text-teal-text' : 'text-text-muted'}`}>
              <IconUpload size={26} />
            </span>

            <span className="mt-3 block text-md font-semibold text-text">
              {browsing
                ? 'Opening…'
                : dragging
                  ? 'Drop to open'
                  : 'Drop an .srt or .mkv file here'}
            </span>
            <span className="mt-1 block text-sm text-text-muted">or click to choose a file</span>
          </button>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger bg-danger-bg px-3 py-2.5 fade-in">
              <IconAlert size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-sm leading-relaxed text-danger">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Track picker */}
      {(phase === 'picking' || phase === 'extracting') && (
        <Modal onClose={closePicker} width={28}>
          <ModalHeader title="Choose a subtitle track" subtitle={mkvName} onClose={closePicker} />

          <div className="max-h-[55vh] overflow-y-auto p-2">
            {tracks.length === 0 && (
              <p className="px-3 py-6 text-center text-base text-text-muted">
                No subtitle tracks to list.
              </p>
            )}

            <div className="space-y-0.5">
              {tracks.map((t) => {
                const selected = selectedId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => t.isText && setSelectedId(t.id)}
                    disabled={!t.isText || phase === 'extracting'}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      selected
                        ? 'bg-teal-soft'
                        : t.isText
                          ? 'hover:bg-surface-alt'
                          : 'cursor-not-allowed opacity-45'
                    }`}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
                        selected ? 'border-teal' : 'border-border-strong'
                      }`}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-teal" />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-base text-text">{t.codec}</span>
                        {!t.isText && <span className="pill pill-warn">needs OCR</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-micro text-text-muted">
                        {languageLabel(t)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <ModalFooter>
            <button onClick={closePicker} disabled={phase === 'extracting'} className="btn btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => void extractSelected()}
              disabled={selectedId == null || phase === 'extracting'}
              className="btn btn-primary"
            >
              {phase === 'extracting' ? 'Extracting…' : 'Extract & translate'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
