import type { ApiSettings } from '@shared/types'

interface Props {
  settings: ApiSettings
  subtitleCount: number
  translating: boolean
}

export function StatusBar({ settings, subtitleCount, translating }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-500">
      <div className="flex items-center gap-4">
        <span>
          {settings.endpointUrl ? (
            <span className="text-green-400">Connected</span>
          ) : (
            <span className="text-gray-600">Not connected</span>
          )}
        </span>
        {settings.modelId && <span>Model: {settings.modelId}</span>}
      </div>
      <div className="flex items-center gap-4">
        {subtitleCount > 0 && <span>{subtitleCount} subtitles loaded</span>}
        {translating && <span className="text-blue-400">Translating...</span>}
      </div>
    </div>
  )
}
