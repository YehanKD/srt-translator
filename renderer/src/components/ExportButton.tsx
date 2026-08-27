import { useState } from 'react'
import type { SubtitleEntry } from '@shared/types'

interface Props {
  entries: SubtitleEntry[]
  sourceFileName: string
}

export function ExportButton({ entries, sourceFileName }: Props) {
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const suggestedName = sourceFileName.replace(/\.srt$/i, '.si.srt')

  const handleExport = async () => {
    setSaving(true)
    setSavedPath(null)
    try {
      const result = await window.electronAPI.exportSrt(entries, suggestedName)
      if (result.success && result.data) {
        setSavedPath(result.data)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-200">Export Translated Subtitles</h3>
          <p className="text-xs text-gray-500 mt-1">{entries.length} subtitles ready</p>
        </div>
        <button
          onClick={handleExport}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white text-sm font-medium py-2 px-5 rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : 'Export SRT'}
        </button>
      </div>
      {savedPath && (
        <p className="text-green-400 text-xs mt-3">Saved to: {savedPath}</p>
      )}
    </div>
  )
}
