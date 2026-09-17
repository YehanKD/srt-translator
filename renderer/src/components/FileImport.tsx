import { useCallback, useRef, useState } from 'react'
import type { SubtitleEntry } from '@shared/types'

interface Props {
  onImport: (entries: SubtitleEntry[], fileName: string) => void
  onMkvDropped?: (mkvPath: string) => void
  disabled: boolean
}

/**
 * Drop zone inside a translation tab. The drag highlight is driven by a depth
 * counter rather than enter/leave booleans, because dragging over a child
 * element fires leave on the parent and would otherwise flicker.
 */
export function FileImport({ onImport, onMkvDropped, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const dragDepth = useRef(0)

  const handleBrowse = useCallback(async () => {
    setDropError('')
    setBrowsing(true)
    try {
      const res = await window.electronAPI.pickInput()
      if (!res.success) {
        setDropError(res.error || 'Could not open that file.')
        return
      }
      const picked = res.data
      if (!picked) return // cancelled

      if (picked.kind === 'mkv') {
        onMkvDropped?.(picked.mkvPath!)
        return
      }
      if (picked.result) onImport(picked.result.entries, picked.result.fileName)
    } finally {
      setBrowsing(false)
    }
  }, [onImport, onMkvDropped])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragDepth.current = 0
      setDragging(false)
      setDropError('')

      const file = e.dataTransfer.files?.[0]
      if (!file) return
      const path = window.electronAPI.getPathForFile(file)
      const lower = (file.name || path).toLowerCase()

      if (lower.endsWith('.mkv')) {
        onMkvDropped?.(path)
        return
      }
      if (!lower.endsWith('.srt')) {
        setDropError('That file type isn’t supported — drop an .srt subtitle or an .mkv movie.')
        return
      }

      const result = await window.electronAPI.importSrtFromPath(path)
      if (result.success && result.data) {
        onImport(result.data.entries, result.data.fileName)
      } else {
        setDropError(result.error || 'Could not read the subtitle file.')
      }
    },
    [onImport, onMkvDropped]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setDragging(true)
  }, [])
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }, [])

  return (
    <div
      onDrop={(e) => void handleDrop(e)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`rounded-lg px-5 py-7 text-center transition-colors ${
        dragging
          ? 'border border-dashed border-teal bg-teal-soft'
          : 'border border-dashed border-border-strong bg-surface'
      }`}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`mx-auto transition-colors ${
          dragging ? 'text-teal-text' : 'text-text-muted'
        }`}
      >
        <path d="M12 16V4m0 0L8 8m4-4l4 4" />
        <path d="M3 15v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
      </svg>

      <p className="mt-3 text-base text-text-body">
        {dragging ? 'Drop to open' : 'Drop an .srt or .mkv file here'}
      </p>
      <p className="mt-1 text-micro text-text-muted">
        or choose a file below
      </p>

      {dropError && (
        <p className="mt-2 text-micro text-danger">{dropError}</p>
      )}

      <button onClick={handleBrowse} disabled={disabled || browsing} className="btn btn-secondary mt-3">
        {browsing ? 'Opening…' : 'Choose file'}
      </button>
    </div>
  )
}
