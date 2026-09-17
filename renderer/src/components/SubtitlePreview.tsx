import type { SubtitleEntry } from '@shared/types'

interface Props {
  source: SubtitleEntry[]
  translated: SubtitleEntry[] | null
  fileName: string
  isTranslating: boolean
  // Anti-spoiler: when true both the English and Sinhala text columns are
  // blurred so you can't accidentally read the story while batch-translating.
  blurred?: boolean
  // When set, some chunks failed: show a warning badge instead of "Translated".
  incomplete?: { failedChunks: number[]; totalChunks: number } | null
}

export function SubtitlePreview({ source, translated, fileName, isTranslating, blurred, incomplete }: Props) {
  const translatedCount = translated?.length ?? 0
  const isComplete = translatedCount >= source.length && !isTranslating && !incomplete

  const blurClass = 'blur-[6px] select-none cursor-not-allowed'

  if (isComplete && translated) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-200">{fileName}</span>
            <span className="text-xs text-gray-500">{source.length} subtitles</span>
          </div>
          <span className="flex items-center gap-2">
            {blurred && (
              <span className="text-xs text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-full">Preview hidden</span>
            )}
            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Translated</span>
          </span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-850">
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="px-3 py-2 text-left w-12">#</th>
                <th className="px-3 py-2 text-left w-32">Time</th>
                <th className="px-3 py-2 text-left">Sinhala</th>
              </tr>
            </thead>
            <tbody>
              {translated.map((entry, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">{i + 1}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs whitespace-nowrap">
                    {entry.startTime} → {entry.endTime}
                  </td>
                  <td className={`px-3 py-2 text-gray-300 ${blurred ? blurClass : ''}`}>{entry.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-200">{fileName}</span>
          <span className="text-xs text-gray-500">{source.length} subtitles</span>
        </div>
        {isTranslating && translatedCount > 0 && (
          <span className="text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
            {translatedCount}/{source.length} translated
          </span>
        )}
        {incomplete && (
          <span className="text-xs text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-full">
            Incomplete — {incomplete.failedChunks.length}/{incomplete.totalChunks} chunks failed
          </span>
        )}
        {blurred && translatedCount > 0 && (
          <span className="text-xs text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded-full">Preview hidden</span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-850">
            <tr className="text-xs text-gray-500 border-b border-gray-800">
              <th className="px-3 py-2 text-left w-12">#</th>
              <th className="px-3 py-2 text-left w-32">Time</th>
              <th className="px-3 py-2 text-left">English</th>
              {translatedCount > 0 && <th className="px-3 py-2 text-left">Sinhala</th>}
            </tr>
          </thead>
          <tbody>
            {source.map((entry, i) => {
              const t = translated?.[i]
              const hasSinhala = t && i < translatedCount && t.text !== entry.text

              return (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">{i + 1}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs whitespace-nowrap">
                    {entry.startTime} → {entry.endTime}
                  </td>
                  <td className={`px-3 py-2 text-gray-300 ${blurred ? blurClass : ''}`}>{entry.text}</td>
                  {translatedCount > 0 && (
                    <td className={`px-3 py-2 ${hasSinhala ? 'text-green-300' : 'text-gray-700'} ${blurred ? blurClass : ''}`}>
                      {hasSinhala ? t.text : '...'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}