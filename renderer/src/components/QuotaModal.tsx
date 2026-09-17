import type { QuotaSummary } from '@shared/types'

interface Props {
  quota: QuotaSummary
  onClose: () => void
  onRefresh: () => void
}

function formatResetTime(resetAt: string | null): string {
  if (!resetAt) return '—'
  try {
    const d = new Date(resetAt)
    return d.toLocaleString()
  } catch {
    return resetAt
  }
}

export function QuotaModal({ quota, onClose, onRefresh }: Props) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-base font-semibold text-gray-100">Quota Details</h3>
            <p className="text-xs text-gray-500">Plan: {quota.plan || 'Free'}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex justify-end">
            <button
              onClick={onRefresh}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              ↻ Refresh
            </button>
          </div>

          {quota.credits !== null && quota.credits !== undefined && (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-300">Google One AI Credits</span>
                <span className="text-sm font-semibold text-gray-100">{quota.credits}</span>
              </div>
            </div>
          )}

          {quota.models.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-3">Per-Model Quota</h4>
              <div className="space-y-2">
                {quota.models.map((m) => (
                  <div key={m.id} className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-gray-200">{m.name}</span>
                      <span className="text-xs text-gray-500">
                        {m.unlimited ? 'Unlimited' : `${Math.round(m.remainingPercentage)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          m.remainingPercentage < 10 ? 'bg-red-500' :
                          m.remainingPercentage < 30 ? 'bg-yellow-500' :
                          'bg-blue-500'
                        }`}
                        style={{ width: `${Math.max(0, m.remainingPercentage)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-500">
                      <span>Used: {m.used}</span>
                      <span>Total: {m.unlimited ? '∞' : m.total}</span>
                      <span>Resets: {formatResetTime(m.resetAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {quota.weekly.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-3">Rate Limits</h4>
              <div className="space-y-2">
                {quota.weekly.map((w) => (
                  <div key={w.key} className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-gray-200">
                        {w.displayName || w.key}
                        <span className="text-gray-500">
                          {' · '}
                          {w.window === '5h' ? '5-hour' : w.window === 'weekly' ? 'Weekly' : ''}
                        </span>
                      </span>
                      <span className="text-xs text-gray-500">
                        {w.unlimited ? 'Unlimited' : `${Math.round(w.remainingPercentage)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          w.remainingPercentage < 10 ? 'bg-red-500' :
                          w.remainingPercentage < 30 ? 'bg-yellow-500' :
                          'bg-purple-500'
                        }`}
                        style={{ width: `${Math.max(0, w.remainingPercentage)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-500">
                      <span>Used: {w.used}</span>
                      <span>Total: {w.unlimited ? '∞' : w.total}</span>
                      <span>Resets: {formatResetTime(w.resetAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-600 text-center">
            Fetched: {new Date(quota.fetchedAt).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}