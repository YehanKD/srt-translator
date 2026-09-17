import { refreshAccessToken, revokeGoogleToken } from './oauth'
import { saveSession, loadPersistedSession, clearPersistedSession } from './storage'
import type { AntigravityAccount } from '@shared/types'

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

  const token = await getAccessToken()
  if (!token) {
    // Refresh token was revoked/expired: clearSession() already wiped storage.
    return false
  }
  return true
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
    } catch {
      // Refresh failed; clear session (and stored credentials) so the UI can
      // ask for a fresh sign-in.
      clearSession()
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