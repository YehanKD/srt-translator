import { BrowserWindow, session as electronSession } from 'electron'
import { GEMINI_ORIGIN, type GeminiWebCredentials } from './protocol'

/**
 * Sign in to Gemini web inside the app.
 *
 * WHY A REAL WINDOW: gemini.google.com is a normal Google sign-in. Driving it
 * headlessly would mean automating a password form and a 2FA challenge, which
 * is fragile, hostile to the user, and unnecessary — a visible window lets them
 * log in the way they already do, including passkeys and any second factor.
 *
 * WHY A SEPARATE PARTITION: the cookies are read from this window's jar. Using
 * a dedicated `persist:` partition keeps the Google session isolated from any
 * other web content the app ever loads, and lets "sign out" be a single
 * clearStorageData call rather than surgical cookie deletion.
 */

const PARTITION = 'persist:gemini-web'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** The two cookies that make a session usable. */
const REQUIRED_COOKIES = ['__Secure-1PSID', '__Secure-1PSIDTS'] as const

export interface LoginResult {
  credentials: GeminiWebCredentials
  email?: string
  buildId?: string
}

export class GeminiWebLoginError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GeminiWebLoginError'
    this.code = code
  }
}

/** Read the session cookies from the login partition. */
async function readCookies(): Promise<Map<string, string>> {
  const ses = electronSession.fromPartition(PARTITION)
  const all = await ses.cookies.get({})
  const wanted = new Map<string, string>()
  for (const c of all) {
    if (!c.name) continue
    if (c.name === 'SAPISID' || REQUIRED_COOKIES.includes(c.name as (typeof REQUIRED_COOKIES)[number])) {
      wanted.set(c.name, c.value)
    }
  }
  return wanted
}

/**
 * Extract the signed-in email from the page.
 *
 * Read from the DOM rather than guessed: the account chip renders the address,
 * and showing the user which account they connected is the difference between a
 * trustworthy sign-in and a mystery. Best-effort — a missing email never fails
 * the login.
 */
async function readEmail(win: BrowserWindow): Promise<string | undefined> {
  try {
    const email = (await win.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector('[aria-label*="@"], [data-email]');
         const text = el ? (el.getAttribute('aria-label') || el.textContent || '') : '';
         const m = text.match(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/);
         return m ? m[0] : '';
       })()`,
      true
    )) as string
    return email || undefined
  } catch {
    return undefined
  }
}

/**
 * Open the login window and resolve once the session cookies exist.
 *
 * Resolves as soon as BOTH required cookies are present — the user does not
 * have to close the window. Polling is used rather than a cookie-change event
 * because the cookies are set by the page after its own handshake, and the
 * `cookies.on('changed')` event fires for every unrelated cookie too.
 */
export async function loginToGeminiWeb(parent?: BrowserWindow | null): Promise<LoginResult> {
  const ses = electronSession.fromPartition(PARTITION)

  // Start clean so a previous account's session cannot leak into this one.
  await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {})

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    parent: parent ?? undefined,
    modal: false,
    title: 'Sign in to Gemini',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      // The login page is Google's; it must not be able to reach Node or the
      // app's preload. Nothing here is trusted.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  const closed = new Promise<never>((_, reject) => {
    win.on('closed', () =>
      reject(
        new GeminiWebLoginError('The sign-in window was closed before finishing.', 'window_closed')
      )
    )
  })

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new GeminiWebLoginError('Sign-in timed out. Try again from Advanced.', 'timeout')
        ),
      LOGIN_TIMEOUT_MS
    )
  )

  const poll = (async (): Promise<LoginResult> => {
    await win.loadURL(`${GEMINI_ORIGIN}/app`)

    for (;;) {
      if (win.isDestroyed()) {
        throw new GeminiWebLoginError('The sign-in window was closed.', 'window_closed')
      }
      const cookies = await readCookies()
      if (REQUIRED_COOKIES.every((n) => cookies.get(n))) {
        const sapisid = cookies.get('SAPISID')
        if (!sapisid) {
          // 1PSID without SAPISID: the session exists but cannot be signed for.
          // Waiting is correct — SAPISID arrives with the same handshake.
          await new Promise((r) => setTimeout(r, 700))
          continue
        }

        const email = await readEmail(win)
        const credentials: GeminiWebCredentials = {
          cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
          sapisid,
          accountPrefix: ''
        }

        // The frontend build id is no longer scraped here: the request runs in
        // the page (page-client.ts) and reads `bl` from the page's own globals
        // at call time, so a copy captured at login would only be able to go
        // stale. `email` is still recorded, because the UI shows who is signed
        // in without needing to open a window.
        return { credentials, email, buildId: undefined }
      }
      await new Promise((r) => setTimeout(r, 700))
    }
  })()

  try {
    return await Promise.race([poll, closed, deadline])
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Drop the stored cookies for the login partition. */
export async function logoutGeminiWeb(): Promise<void> {
  const ses = electronSession.fromPartition(PARTITION)
  await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {})
}

/** True when the login partition currently holds a usable session. */
export async function hasGeminiWebSession(): Promise<boolean> {
  try {
    const cookies = await readCookies()
    return REQUIRED_COOKIES.every((n) => cookies.get(n)) && Boolean(cookies.get('SAPISID'))
  } catch {
    return false
  }
}

/** Re-read cookies from the partition (the page refreshes 1PSIDTS itself). */
export async function refreshCredentials(): Promise<GeminiWebCredentials | null> {
  const cookies = await readCookies()
  const sapisid = cookies.get('SAPISID')
  if (!sapisid || !REQUIRED_COOKIES.every((n) => cookies.get(n))) return null
  return {
    cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    sapisid,
    accountPrefix: ''
  }
}

export { PARTITION as GEMINI_WEB_PARTITION }
