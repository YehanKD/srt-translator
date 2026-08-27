import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubtitleEntry, MkvSubtitleTrack } from '@shared/types'

interface Props {
  onOpenTranslator: () => void
  onLoaded: (entries: SubtitleEntry[], fileName: string) => void
  initialMkvPath?: string | null
  onMkvPathConsumed?: () => void
}

type Phase = 'idle' | 'picking' | 'extracting'

export function HomeView({ onOpenTranslator, onLoaded, initialMkvPath, onMkvPathConsumed }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [mkvPath, setMkvPath] = useState('')
  const [mkvName, setMkvName] = useState('')
  const [tracks, setTracks] = useState<MkvSubtitleTrack[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
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
      setTracks((res.data || []) as MkvSubtitleTrack[])
      setPhase((res.data && (res.data as MkvSubtitleTrack[]).length > 0) ? 'picking' : 'idle')
      if (res.data && res.data.length === 0) setError('No subtitle tracks found in this movie.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }, [])

  const openMkv = useCallback(async () => {
    const res = await window.electronAPI.selectMkv()
    if (res.success && res.data) void listTracksFor(res.data)
  }, [listTracksFor])

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

  // ── Drag & drop (whole home area) ─────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])
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
        setError('Drop an .mkv movie or an .srt subtitle file.')
      }
    },
    [listTracksFor, onLoaded]
  )

  const languageLabel = (t: MkvSubtitleTrack) => {
    const lang = t.language && t.language !== 'und' ? t.language.toUpperCase() : 'Any'
    const extra = t.trackName ? ` · ${t.trackName}` : ''
    return `${lang}${extra}`
  }

  return (
    <div
      className={`flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto transition-colors ${
        dragging ? 'bg-blue-950/40' : 'bg-transparent'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C12.083 10.77 8.07 15.61 3 18.129" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-100">SRT Translator</h1>
        <p className="text-gray-500 mt-1">Extract movie subtitles, then translate English → natural spoken Sinhala</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-3xl">
        {/* Card 1: translate directly */}
        <button
          onClick={onOpenTranslator}
          className="group p-6 rounded-2xl border border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900 text-left transition-colors"
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-gray-800 group-hover:bg-blue-600/20">
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-100">Translate a Subtitle (.srt)</h2>
          <p className="text-sm text-gray-500 mt-1">Load an existing subtitle file and translate it to Sinhala.</p>
        </button>

        {/* Card 2: extract from movie */}
        <button
          onClick={() => void openMkv()}
          disabled={phase === 'extracting'}
          className="group p-6 rounded-2xl border border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900 text-left transition-colors disabled:opacity-60"
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-gray-800 group-hover:bg-blue-600/20">
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M7 4h8l3 3v13H7V4zM10 4v3h5M10 12h6m-6 4h6" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-100">
            Extract Subtitles from a Movie (.mkv)
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Pick a subtitle track from an MKV and load it straight into the translator.
          </p>
        </button>
      </div>

      <div className="mt-8 text-center">
        <p className="text-xs text-gray-600">
          {phase === 'extracting' ? 'Extracting subtitle track…' : 'or drag & drop an .mkv movie or an .srt file here'}
        </p>
      </div>

      {error && (
        <div className="mt-5 max-w-xl w-full px-4 py-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-sm text-center">
          {error}
        </div>
      )}

      {/* Track picker modal */}
      {(phase === 'picking' || phase === 'extracting') && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50 p-6">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-100 truncate">Choose a subtitle track</h3>
                <p className="text-xs text-gray-500 truncate">{mkvName}</p>
              </div>
              <button onClick={closePicker} disabled={phase === 'extracting'} className="text-gray-500 hover:text-gray-300 disabled:opacity-40 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {tracks.length === 0 && (
                <p className="text-sm text-gray-500 px-3 py-4 text-center">No subtitle tracks to list.</p>
              )}
              {tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => t.isText && setSelectedId(t.id)}
                  disabled={!t.isText || phase === 'extracting'}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                    selectedId === t.id
                      ? 'bg-blue-600/20 border border-blue-600/50'
                      : 'border border-transparent hover:bg-gray-800'
                  } disabled:hover:bg-transparent`}
                >
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${selectedId === t.id ? 'border-blue-500' : 'border-gray-600'}`}>
                    {selectedId === t.id && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={t.isText ? 'text-gray-200' : 'text-gray-500'}>
                      {t.isText ? t.codec : `${t.codec} — not translatable`}
                    </span>
                    <span className="block text-xs text-gray-500">{languageLabel(t)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
              <button
                onClick={closePicker}
                disabled={phase === 'extracting'}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 border border-gray-700 hover:bg-gray-800 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void extractSelected()}
                disabled={selectedId == null || phase === 'extracting'}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
              >
                {phase === 'extracting' ? 'Extracting…' : 'Extract & Translate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}