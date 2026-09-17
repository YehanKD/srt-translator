import { refreshAccessToken, revokeGoogleToken, OAuthError } from './oauth'
import { saveSession, loadPersistedSession, clearPersistedSession } from './storage'
import type { AntigravityAccount } from '@shared/types'

/**
 * True only when Google has definitively rejected the refresh token, i.e. the
 * user must sign in again. Anything else (network error, timeout, 5xx) is
 * transient and must not destroy the stored login.
 */
function isPermanentAuthFailure(err: unknown): boolean {
  const code = err instanceof OAuthError ? err.code : ''
  const message = err instanceof Error ? err.message : String(err)
  return (
    code === 'token_exchange' ||
    code === 'refresh_failed' ||
    /invalid_grant|invalid_request|unauthorized_client|expired|revoked/i.test(message)
  )
}

export interface AntigravitySession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // timestamp in ms
  email: string
  picture?: string
  plan: string
  projectId: string | null
  tierId: string | null
  connectedAt: number
}

let session: AntigravitySession | null = null

export function getSession(): AntigravitySession | null {
  return session
}

export function setSession(data: AntigravitySession): void {
  session = data
  // Remember the account so the next launch can refresh instead of asking the
  // user to sign in with Google again.
  saveSession(data)
}

export function clearSession(): void {
  session = null
  clearPersistedSession()
}

export function getAccount(): AntigravityAccount | null {
  if (!session) return null
  return {
    email: session.email,
    picture: session.picture,
    plan: session.plan,
    projectId: session.projectId,
    tierId: session.tierId,
    connectedAt: session.connectedAt
  }
}

/**
 * Restore a session from the encrypted store at startup. Returns true when an
 * account is available (the access token is fetched lazily by getAccessToken).
 * Returns false when there is nothing stored or the refresh token is dead.
 */
export async function restoreSession(): Promise<boolean> {
  if (session) return true
  const saved = loadPersistedSession()
  if (!saved) return false

  session = {
    // No access token yet — getAccessToken() refreshes it on first use.
    accessToken: '',
    refreshToken: saved.refreshToken,
    // Force an immediate refresh.
    expiresAt: 0,
    email: saved.email,
    picture: saved.picture,
    plan: saved.plan,
    projectId: saved.projectId,
    tierId: saved.tierId,
    connectedAt: saved.connectedAt
  }

  // Startup is exactly when a transient failure is most likely (network not up
  // yet, DNS still resolving, VPN connecting). Retry a few times before
  // declaring the session unusable, so a blip doesn't cost the user a sign-in.
  const attempts = 3
  for (let i = 0; i < attempts; i++) {
    const token = await getAccessToken()
    if (token) return true
    // clearSession() ran => the refresh token is genuinely dead; stop retrying.
    if (!getSession()) return false
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
  }
  return false
}

export async function getAccessToken(): Promise<string | null> {
  if (!session) return null
  // If token is about to expire (within 5 min), refresh
  const now = Date.now()
  if (session.expiresAt && now + 5 * 60 * 1000 >= session.expiresAt) {
    if (!session.refreshToken) return null
    try {
      const tokens = await refreshAccessToken(session.refreshToken)
      session.accessToken = tokens.accessToken
      if (tokens.refreshToken) session.refreshToken = tokens.refreshToken
      if (tokens.expiresIn) session.expiresAt = now + tokens.expiresIn * 1000
      // Keep the stored refresh token current (Google may rotate it).
      saveSession(session)
      return session.accessToken
    } catch (err) {
      // Only discard the stored credential when Google definitively rejected
      // it (invalid_grant / revoked). A network blip, timeout, or 5xx must NOT
      // delete the user's login — that would force a full sign-in on every
      // flaky start. Keep the in-memory session so a retry can succeed.
      if (isPermanentAuthFailure(err)) {
        clearSession()
      } else {
        session.expiresAt = now + 60 * 1000 // retry in a minute
      }
      return null
    }
  }
  return session.accessToken
}

export async function logout(): Promise<void> {
  if (session?.accessToken) {
    await revokeGoogleToken(session.accessToken).catch(() => {})
  }
  // clearSession() also removes the persisted (encrypted) refresh token.
  clearSession()
}