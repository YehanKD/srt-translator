import { useEffect, useState } from 'react'
import type { GeminiWebStatus, GeminiWebProbeResult } from '@shared/types'
import { IconSpinner } from './Icons'

/**
 * Connect the Gemini web provider.
 *
 * WHY THIS IS A SECOND PROVIDER: Antigravity has stopped offering the newest
 * Gemini Pro models to some accounts (they return 404), while the same models
 * are live on the Gemini web app. This section connects that account so those
 * models become selectable — without disturbing the existing Antigravity login,
 * which stays the default.
 *
 * The sign-in is a real window pointed at gemini.google.com, so the user logs in
 * normally (passkeys and 2FA included) and the app reads the session cookies
 * from its own jar. Nothing touches the system browser.
 *
 * The "Check availability" button exists because the tier→model mapping is
 * decided server-side: the request carries a numeric tier, not a model name, so
 * the only honest answer to "do I get the newest Pro?" is to ask. It is manual
 * rather than automatic because each check spends a real request against the
 * account.
 */
export function GeminiWebSection() {
  const [status, setStatus] = useState<GeminiWebStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState<GeminiWebProbeResult[] | null>(null)
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const r = await window.electronAPI.geminiWebStatus()
    if (r.success && r.data) setStatus(r.data)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const connect = async () => {
    setBusy(true)
    setError(null)
    setProbe(null)
    try {
      const r = await window.electronAPI.geminiWebConnect()
      if (r.success && r.data) setStatus(r.data)
      else setError(r.error ?? 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    setProbe(null)
    try {
      await window.electronAPI.geminiWebDisconnect()
      setStatus({ signedIn: false, canPersist: status?.canPersist ?? true })
    } finally {
      setBusy(false)
    }
  }

  const runProbe = async () => {
    setProbing(true)
    setError(null)
    try {
      const r = await window.electronAPI.geminiWebProbe()
      if (r.success && r.data) setProbe(r.data)
      else setError(r.error ?? 'Could not check availability.')
    } finally {
      setProbing(false)
    }
  }

  const signedIn = Boolean(status?.signedIn)

  return (
    <div className="rounded-lg border border-border bg-surface-alt px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="field-label">Gemini web</span>
        {signedIn ? (
          <span className="chip chip-success">Connected</span>
        ) : (
          <span className="chip">Not connected</span>
        )}
      </div>

      <p className="mt-1 text-micro leading-relaxed text-text-muted">
        Translate with the models on your Gemini web account. Useful when a model
        has reached the Gemini app but not the Antigravity API yet — those return
        “not found” there, so this reaches them instead. Your Antigravity login is
        untouched and stays the default.
      </p>

      {signedIn && status?.email && (
        <p className="mt-1.5 text-micro text-text-body">
          Signed in as <span className="font-semibold">{status.email}</span>
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {!signedIn ? (
          <button onClick={connect} disabled={busy} className="btn btn-secondary">
            {busy ? (
              <>
                <IconSpinner />
                Waiting for sign-in…
              </>
            ) : (
              'Sign in to Gemini'
            )}
          </button>
        ) : (
          <>
            <button onClick={runProbe} disabled={probing || busy} className="btn btn-secondary">
              {probing ? (
                <>
                  <IconSpinner />
                  Checking…
                </>
              ) : (
                'Check model availability'
              )}
            </button>
            <button onClick={disconnect} disabled={busy} className="btn btn-ghost">
              Disconnect
            </button>
          </>
        )}
      </div>

      {!status?.canPersist && signedIn && (
        <p className="mt-1.5 text-micro text-text-muted">
          No system keyring found — you will need to sign in again next launch.
        </p>
      )}

      {error && <p className="mt-1.5 text-micro text-danger">{error}</p>}

      {probe && (
        <div className="mt-2 space-y-1">
          <span className="text-micro text-text-muted">
            Checked by making a real request for each model:
          </span>
          {probe.map((p) => (
            <div key={p.mode} className="flex items-baseline justify-between gap-2 text-micro">
              <span className="truncate text-text-body">{p.name}</span>
              <span className={p.ok ? 'text-teal-text' : 'text-danger'}>
                {p.ok ? 'available' : 'unavailable'}
              </span>
            </div>
          ))}
          {probe.some((p) => !p.ok) && (
            <p className="text-micro leading-relaxed text-text-muted">
              A model shown as unavailable was refused by Google for this account.
              It will not work as a translation model until it is offered again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
