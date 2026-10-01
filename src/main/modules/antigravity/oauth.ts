import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { randomBytes } from 'crypto'
import { ANTIGRAVITY_OAUTH, OAUTH_TIMEOUT_MS } from './constants'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  /** Present when Google issues one; carries the account email as a claim. */
  idToken?: string
}

export class OAuthError extends Error {
  code: string
  constructor(message: string, code = 'oauth_error') {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}

export function generateOAuthState(): string {
  return randomBytes(24).toString('hex')
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_OAUTH.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_OAUTH.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${ANTIGRAVITY_OAUTH.authorizeUrl}?${params.toString()}`
}

export interface OAuthListener {
  redirectUri: string
  waitForCode: Promise<{ code: string; state: string }>
  close: () => void
}

/**
 * Start a loopback HTTP server that waits for Google's OAuth redirect.
 * The code/state arrive as query params on the callback path.
 */
export function startOAuthListener(): OAuthListener {
  let server: ReturnType<typeof createServer> | null = null
  let resolveCode: ((v: { code: string; state: string }) => void) | null = null
  let rejectCode: ((e: Error) => void) | null = null

  const waitForCode = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const html = (title: string, body: string) =>
      `<html><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;background:#0a0a0b;color:#e5e5e5;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#9ca3af">${body}</p></div></body></html>`

    if (url.pathname !== ANTIGRAVITY_OAUTH.callbackPath) {
      res.writeHead(404).end('Not found')
      return
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (code) {
      res.end(html('Signed in ✓', 'You can close this tab and return to SRT Translator.'))
      resolveCode?.({ code, state: state ?? '' })
    } else {
      res.end(html('Sign-in failed', 'No authorization code was returned. Close this tab and try again.'))
      rejectCode?.(new OAuthError('Google did not return an authorization code', 'no_code'))
    }
    server?.close()
    server = null
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    rejectCode?.(err)
  })

  const redirectUriPromise = new Promise<string>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const { port } = (server?.address() as AddressInfo) ?? { port: 0 }
      resolve(`http://127.0.0.1:${port}${ANTIGRAVITY_OAUTH.callbackPath}`)
    })
  })

  const listener: OAuthListener = {
    redirectUri: '',
    waitForCode,
    close: () => server?.close()
  }
  void redirectUriPromise.then((uri) => {
    listener.redirectUri = uri
  })
  return listener
}

/** Block until the listener has an actual bound redirect URI. */
export function awaitRedirectUri(listener: OAuthListener): Promise<string> {
  return listener.redirectUri
    ? Promise.resolve(listener.redirectUri)
    : new Promise((resolve, reject) => {
        const t0 = Date.now()
        const iv = setInterval(() => {
          if (listener.redirectUri) {
            clearInterval(iv)
            resolve(listener.redirectUri)
          } else if (Date.now() - t0 > 5000) {
            clearInterval(iv)
            reject(new OAuthError('Could not bind OAuth callback listener', 'bind_failed'))
          }
        }, 25)
      })
}

// Token endpoint helpers -------------------------------------------------------

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = { raw: text }
  }
  if (!response.ok) {
    throw new OAuthError(
      String(data.error_description || data.error || data.raw || `HTTP ${response.status}`),
      'token_exchange'
    )
  }
  return data
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: ANTIGRAVITY_OAUTH.clientId,
    client_secret: ANTIGRAVITY_OAUTH.clientSecret,
    code,
    redirect_uri: redirectUri
  })
  const data = await postForm(ANTIGRAVITY_OAUTH.tokenUrl, body)
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError('Token response missing access_token', 'no_access_token')
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresIn: typeof data.expires_in === 'number' ? (data.expires_in as number) : undefined,
    idToken: typeof data.id_token === 'string' ? (data.id_token as string) : undefined
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ANTIGRAVITY_OAUTH.clientId,
    client_secret: ANTIGRAVITY_OAUTH.clientSecret,
    refresh_token: refreshToken
  })
  const data = await postForm(ANTIGRAVITY_OAUTH.tokenUrl, body)
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError('Refresh failed: no access_token returned', 'refresh_failed')
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken,
    expiresIn: typeof data.expires_in === 'number' ? (data.expires_in as number) : undefined
  }
}

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${ANTIGRAVITY_OAUTH.revokeUrl}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  } catch {
    // Revocation is best-effort.
  }
}

export { OAUTH_TIMEOUT_MS }
