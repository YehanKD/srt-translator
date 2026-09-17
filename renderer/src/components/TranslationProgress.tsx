import type { OverallProgress } from '../hooks/useTranslation'

interface Props {
  progress: OverallProgress | null
  onCancel: () => void
  error: string | null
  /** Set when some chunks failed permanently — the result is NOT complete. */
  incomplete?: { failedChunks: number[]; totalChunks: number } | null
}

export function TranslationProgress({ progress, onCancel, error, incomplete }: Props) {
  if (!progress && !error) return null

  const percent = progress ? Math.round((progress.completedChunks / progress.totalChunks) * 100) : 0
  const isDone = progress?.status === 'done' && !incomplete

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-200">
          {incomplete
            ? 'Translation Incomplete'
            : progress?.status === 'error'
              ? 'Translation Error'
              : isDone
                ? 'Translation Complete'
                : 'Translating...'}
        </h3>
        {!isDone && (
          <button
            onClick={onCancel}
            className="text-xs text-red-400 hover:text-red-300 px-3 py-1 rounded border border-red-400/30 hover:border-red-400/50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {incomplete && (
        <p className="text-amber-300 text-sm mb-2">
          {incomplete.failedChunks.length} of {incomplete.totalChunks} chunk
          {incomplete.totalChunks === 1 ? '' : 's'} failed after all retries. Those lines are still in
          the original language — review them before exporting.
        </p>
      )}

      {progress && progress.status !== 'error' && !incomplete && (
        <>
          <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {isDone
              ? `Translation complete — ${progress.completedChunks} of ${progress.totalChunks} chunks`
              : `${progress.completedChunks} of ${progress.totalChunks} chunks done (${percent}%)${progress.activeChunks > 0 ? ` • ${progress.activeChunks} active` : ''}`}
          </p>
        </>
      )}

      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      {progress?.status === 'error' && progress.errorMessage && (
        <p className="text-red-400 text-sm mt-2">{progress.errorMessage}</p>
      )}
    </div>
  )
}
