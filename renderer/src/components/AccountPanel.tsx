import { useState } from 'react'
import type { AntigravityModel, QuotaSummary } from '@shared/types'

interface Props {
  status: { signedIn: boolean; account: { email: string; plan: string } | null }
  quota: QuotaSummary | null
  models: AntigravityModel[]
  selectedModelId: string
  loading: boolean
  error: string | null
  /** false = no OS keyring, so the sign-in can't be remembered across launches. */
  canPersist?: boolean
  onLogin: () => void
  onLogout: () => void
  onSelectModel: (id: string) => void
  onRefreshQuota: () => void
  onShowQuotaDetail: () => void
}

export function AccountPanel({
  status,
  quota,
  models,
  selectedModelId,
  loading,
  error,
  canPersist = true,
  onLogin,
  onLogout,
  onSelectModel,
  onRefreshQuota,
  onShowQuotaDetail
}: Props) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  if (!status.signedIn) {
    return (
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-300">Sign in to Translate</h3>
          <p className="text-xs text-gray-500">Use your Google account with Antigravity quota</p>
          {!canPersist && (
            <p className="text-xs text-amber-400/90">
              No system keyring detected — you'll need to sign in again next launch.
            </p>
          )}
          <button
            onClick={onLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing in...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Sign in with Google
              </>
            )}
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 space-y-4">
      {/* Account header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-blue-600/30 flex items-center justify-center shrink-0">
            <span className="text-blue-300 text-sm font-medium">
              {status.account?.email?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-100 truncate">{status.account?.email || 'Unknown'}</p>
            <p className="text-xs text-gray-500">{status.account?.plan || 'Free'}</p>
          </div>
        </div>
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Logout confirm modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full">
            <h4 className="text-sm font-semibold text-gray-100 mb-2">Sign out?</h4>
            <p className="text-xs text-gray-500 mb-4">You'll need to sign in again to translate.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-300 border border-gray-700 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { onLogout(); setShowLogoutConfirm(false); }}
                className="px-3 py-1.5 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model selector */}
      {models.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Model</label>
          <select
            value={selectedModelId}
            onChange={(e) => onSelectModel(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Quota compact */}
      {quota && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Quota</span>
            <button
              onClick={onRefreshQuota}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Refresh
            </button>
          </div>
          <button
            onClick={onShowQuotaDetail}
            className="w-full text-left bg-gray-800/50 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {quota.models.length > 0 ? (
                  `${quota.models.length} model${quota.models.length > 1 ? 's' : ''} available`
                ) : (
                  'No quota data'
                )}
              </span>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            {quota.models.length > 0 && (
              <div className="mt-1 flex gap-1">
                {quota.models.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex-1 h-1 bg-gray-700 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded"
                      style={{ width: `${Math.max(0, m.remainingPercentage)}%` }}
                    />
                  </div>
                ))}
                {quota.models.length > 3 && (
                  <span className="text-xs text-gray-500">+{quota.models.length - 3}</span>
                )}
              </div>
            )}
          </button>
        </div>
      )}
    </div>
  )
}