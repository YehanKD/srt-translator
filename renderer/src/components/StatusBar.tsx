interface Props {
  signedIn: boolean
  accountEmail?: string
  modelId: string
  subtitleCount: number
  translating: boolean
}

export function StatusBar({ signedIn, accountEmail, modelId, subtitleCount, translating }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-500">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${signedIn ? 'bg-green-500' : 'bg-gray-600'}`} />
          {signedIn ? (
            <span className="text-green-400">{accountEmail || 'Signed in'}</span>
          ) : (
            <span className="text-gray-600">Not signed in</span>
          )}
        </span>
        {modelId && <span>Model: {modelId}</span>}
      </div>
      <div className="flex items-center gap-4">
        {subtitleCount > 0 && <span>{subtitleCount} subtitles loaded</span>}
        {translating && <span className="text-blue-400">Translating...</span>}
      </div>
    </div>
  )
}