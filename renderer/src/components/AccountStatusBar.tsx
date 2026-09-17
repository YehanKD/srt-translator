import { useState } from 'react'
import type { QuotaSummary } from '@shared/types'
import { ConfirmModal } from './ConfirmModal'
import { relativeReset, tightest } from '../lib/quota'
import { IconSliders, IconSpinner, IconLogout, IconRefresh } from './Icons'

interface Props {
  status: { signedIn: boolean; account: { email: string; plan: string } | null; needsReauth?: boolean }
  quota: QuotaSummary | null
  loading: boolean
  error: string | null
  /** false = no OS keyring, so the sign-in can't be remembered across launches. */
  canPersist?: boolean
  onLogin: () => void
  onLogout: () => void
  onRefreshQuota: () => void
  onShowAdvanced: () => void
  onShowQuotaDetail: () => void
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

/**
 * Account / model / quota strip. 66px tall, sitting directly under the header.
 * Everything that used to live in a full-height sidebar is here, horizontally —
 * a permanent column cost the workspace its width and left a dead area below it.
 */
export function AccountStatusBar({
  status,
  quota,
  loading,
  error,
  canPersist = true,
  onLogin,
  onLogout,
  onRefreshQuota,
  onShowAdvanced,
  onShowQuotaDetail
}: Props) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  // ── Signed out ────────────────────────────────────────────────────────────
  if (!status.signedIn) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-8 py-3">
        <p className="text-base text-text-body">
          Sign in with Google to translate using the quota on your own account.
        </p>

        <button onClick={onLogin} disabled={loading} className="btn btn-primary ml-auto">
          {loading ? (
            <>
              <IconSpinner />
              Waiting for browser…
            </>
          ) : (
            <>
              <GoogleGlyph />
              Sign in with Google
            </>
          )}
        </button>

        {!canPersist && (
          <span className="text-micro text-text-muted" title="No system keyring found">
            won't be remembered next launch
          </span>
        )}
        {error && <span className="text-micro text-danger">{error}</span>}
      </div>
    )
  }

  // ── Signed in ─────────────────────────────────────────────────────────────
  const email = status.account?.email || 'Unknown'
  const plan = status.account?.plan || 'Free'
  const initial = email.charAt(0).toUpperCase() || '?'

  const t = quota ? tightest(quota.models) : null
  const reset = relativeReset(t?.resetAt ?? null)
  const pct = t ? Math.round(t.remainingPercentage) : null

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-6 border-b border-border bg-surface px-8 py-3">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-soft text-base font-bold text-teal-deep">
            {initial}
          </span>

          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-base font-semibold leading-tight text-text" title={email}>
              {email}
            </span>
            <span className="text-micro leading-tight text-text-muted">
              {plan.toLowerCase().includes('pro') ? 'Paid plan member' : 'Organization member'}
            </span>
          </span>

          <span className="pill shrink-0">{plan}</span>

          {/* Session expiry. Previously `needsReauth` was computed in the main
              process but never shown anywhere, so an expired Google session
              failed silently — you'd only find out when a translation broke. */}
          {status.needsReauth && (
            <button
              onClick={onLogin}
              className="chip chip-danger shrink-0"
              title="Your Google session expired. Sign in again to keep translating."
            >
              Session expired — sign in again
            </button>
          )}
        </div>

        {/* Quota + Advanced. The model picker lives inside Advanced now, so the
            strip only carries ambient status and one escape hatch. */}
        <div className="flex shrink-0 items-center gap-4">
          {quota && (
            <div className="flex items-center gap-3">
              <button
                onClick={onShowQuotaDetail}
                className="flex flex-col items-end gap-0.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-alt"
                title="Show the full quota breakdown"
              >
                <span className="text-sm font-semibold text-text">
                  Quota:{' '}
                  <span className="text-teal-text">
                    {pct === null ? 'no data' : `${pct}% left`}
                  </span>
                </span>
                <span className="text-mini text-text-muted">
                  {reset ? `Resets in ${reset}` : 'No reset reported'}
                </span>
              </button>

              <button
                onClick={onRefreshQuota}
                className="btn-icon"
                title="Refresh quota"
                aria-label="Refresh quota"
              >
                <IconRefresh size={14} />
              </button>

              {pct !== null && (
                <span className="meter w-[100px]" title={`${pct}% remaining`}>
                  <span
                    className="meter-fill block"
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                  />
                </span>
              )}
            </div>
          )}

          <button
            onClick={onShowAdvanced}
            className="btn btn-secondary"
            title="Advanced settings"
          >
            <IconSliders size={15} />
            Advanced
          </button>

          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="btn-icon"
            title="Sign out"
            aria-label="Sign out"
          >
            <IconLogout size={15} />
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <ConfirmModal
          title="Sign out?"
          body="You'll need to sign in again before translating. Your saved session will be removed from this device."
          confirmLabel="Sign out"
          danger
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            onLogout()
            setShowLogoutConfirm(false)
          }}
        />
      )}
    </>
  )
}
