import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { GeminiWebCredentials } from './protocol'

/**
 * Persist the Gemini web session between launches.
 *
 * The cookies are a live Google credential — __Secure-1PSID alone is enough to
 * act as the user on gemini.google.com — so they are NEVER written in plaintext.
 * They go through Electron's `safeStorage`, the same OS keyring path the
 * Antigravity session uses (GNOME Keyring/KWallet, DPAPI, Keychain).
 *
 * If the platform cannot encrypt, nothing is stored: silently writing a Google
 * session cookie in the clear would be worse than asking for a fresh sign-in.
 *
 * Kept in its own file (`gemini-web.bin`) rather than merged into the
 * Antigravity session so signing out of one provider cannot silently clear the
 * other — the two are independent logins to different services.
 */

interface PersistedGeminiWeb {
  cookie: string
  sapisid: string
  accountPrefix: string
  email?: string
  /** Build id captured at login, so the first request need not scrape. */
  buildId?: string
  connectedAt: number
  version: 1
}

function storeFile(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'gemini-web.bin')
}

/** True when the OS keyring is available for encrypting the cookies. */
export function canPersistGeminiWeb(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveGeminiWeb(
  creds: GeminiWebCredentials,
  extra: { email?: string; buildId?: string } = {}
): void {
  if (!creds.cookie || !creds.sapisid) return
  if (!canPersistGeminiWeb()) return

  const payload: PersistedGeminiWeb = {
    cookie: creds.cookie,
    sapisid: creds.sapisid,
    accountPrefix: creds.accountPrefix ?? '',
    email: extra.email,
    buildId: extra.buildId,
    connectedAt: Date.now(),
    version: 1
  }

  try {
    writeFileSync(storeFile(), safeStorage.encryptString(JSON.stringify(payload)), {
      mode: 0o600
    })
  } catch {
    // A disk/keyring failure must never break a sign-in that just succeeded.
  }
}

export function loadGeminiWeb(): (GeminiWebCredentials & { email?: string; buildId?: string; connectedAt: number }) | null {
  if (!canPersistGeminiWeb()) return null
  try {
    const data = JSON.parse(safeStorage.decryptString(readFileSync(storeFile()))) as PersistedGeminiWeb
    if (data.version !== 1 || typeof data.cookie !== 'string' || !data.cookie) return null
    if (typeof data.sapisid !== 'string') return null
    return {
      cookie: data.cookie,
      sapisid: data.sapisid,
      accountPrefix: data.accountPrefix ?? '',
      email: data.email,
      buildId: data.buildId,
      connectedAt: data.connectedAt
    }
  } catch {
    // Missing, corrupt, or encrypted under a different OS keyring: treat as
    // signed out and clear it so a bad blob is not retried every launch.
    clearGeminiWeb()
    return null
  }
}

export function clearGeminiWeb(): void {
  try {
    rmSync(storeFile(), { force: true })
  } catch {
    // Nothing to remove.
  }
}
