import { useCallback, useRef, useState } from 'react'
import type { SubtitleEntry } from '@shared/types'

interface Props {
  onImport: (entries: SubtitleEntry[], fileName: string) => void
  onMkvDropped?: (mkvPath: string) => void
  disabled: boolean
}

export function FileImport({ onImport, onMkvDropped, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState('')
  const dragDepth = useRef(0)

  const handleBrowse = useCallback(async () => {
    const result = await window.electronAPI.importSrt()
    if (result.success && result.data) {
      onImport(result.data.entries, result.data.fileName)
    }
  }, [onImport])

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
        setDropError('Drop an .srt subtitle file or an .mkv movie.')
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
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
        dragging ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="text-4xl mb-3 opacity-30">
        <svg className="w-12 h-12 mx-auto text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>
      <p className="text-gray-400 text-sm mb-3">Drop an .srt or .mkv file here or click to browse</p>
      {dropError && <p className="text-xs text-red-400 mb-3">{dropError}</p>}
      <button
        onClick={handleBrowse}
        disabled={disabled}
        className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-600 text-gray-200 text-sm font-medium py-2 px-5 rounded-lg border border-gray-700 transition-colors"
      >
        Browse Files
      </button>
    </div>
  )
}
