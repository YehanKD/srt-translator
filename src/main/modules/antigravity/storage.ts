import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { AntigravitySession } from './session'

/**
 * Persist the Antigravity session between launches.
 *
 * The refresh token is a long-lived Google credential, so it is NEVER written
 * in plaintext: it goes through Electron's `safeStorage`, which uses the OS
 * keyring (GNOME Keyring/KWallet on Linux, DPAPI on Windows, Keychain on
 * macOS). If the platform cannot encrypt, we store nothing at all — silently
 * falling back to plaintext would be worse than asking the user to sign in
 * again.
 *
 * Access tokens are deliberately NOT persisted: they expire in ~1h and are
 * refreshed on demand from the refresh token.
 */

interface PersistedSession {
  refreshToken: string
  email: string
  picture?: string
  plan: string
  projectId: string | null
  tierId: string | null
  connectedAt: number
  /** Marker so a future format change can be detected and discarded. */
  version: 1
}

function sessionFile(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'session.bin')
}

/** True when the OS keyring is available for encrypting the refresh token. */
export function canPersistSession(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveSession(session: AntigravitySession): void {
  if (!session.refreshToken) return
  if (!canPersistSession()) {
    // No keyring — don't persist rather than write a plaintext credential.
    return
  }

  const payload: PersistedSession = {
    refreshToken: session.refreshToken,
    email: session.email,
    picture: session.picture,
    plan: session.plan,
    projectId: session.projectId,
    tierId: session.tierId,
    connectedAt: session.connectedAt,
    version: 1
  }

  try {
    const encrypted = safeStorage.encryptString(JSON.stringify(payload))
    writeFileSync(sessionFile(), encrypted, { mode: 0o600 })
  } catch {
    // Disk/keyring failure must never break a successful sign-in.
  }
}

export function loadPersistedSession(): PersistedSession | null {
  if (!canPersistSession()) return null
  try {
    const raw = readFileSync(sessionFile())
    const data = JSON.parse(safeStorage.decryptString(raw)) as PersistedSession
    if (data.version !== 1 || typeof data.refreshToken !== 'string' || !data.refreshToken) {
      return null
    }
    return data
  } catch {
    // Missing, corrupt, or encrypted by a different OS user/keyring: treat as
    // signed out and clear it so we don't retry a bad blob every launch.
    clearPersistedSession()
    return null
  }
}

export function clearPersistedSession(): void {
  try {
    rmSync(sessionFile(), { force: true })
  } catch {
    // Nothing to remove.
  }
}
