/**
 * Antigravity (Gemini Code Assist) integration constants.
 *
 * The OAuth client id/secret below are the PUBLIC credentials shipped inside
 * Google's own Antigravity IDE/CLI (verified byte-for-byte against the values
 * embedded in OmniRoute v16 and CLIProxyAPI). They identify the *Antigravity
 * client application* to Google — they are not user secrets and cannot be
 * rotated per-user. We reuse them so a consumer Google account can sign in and
 * use the Antigravity quota attached to that account, exactly like the
 * official desktop app does.
 */

export const ANTIGRAVITY_OAUTH = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: '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',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
  // No "openid" scope: requesting it with this client routed Google into the
  // hanging firstparty/nativeapp consent screen. These five scopes are what the
  // official Antigravity client requests.
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
  ],
  // Loopback redirect for installed-app OAuth. Google allows any localhost port.
  callbackPath: '/oauth-callback'
}

/** Where the loopback listener binds while waiting for the OAuth callback. */
export const OAUTH_CALLBACK_PORT = 51237
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Code Assist backend. `cloudcode-pa.googleapis.com` is the production
 * bootstrap host (loadCodeAssist / onboardUser); inference and quota RPCs also
 * accept the daily variant first, falling back to prod.
 */
export const ANTIGRAVITY_BOOTSTRAP_BASE_URLS = Object.freeze([
  'https://cloudcode-pa.googleapis.com'
])
export const ANTIGRAVITY_RUNTIME_BASE_URLS = Object.freeze([
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
])
export const ANTIGRAVITY_DISCOVERY_BASE_URLS = Object.freeze([
  ...ANTIGRAVITY_RUNTIME_BASE_URLS,
  'https://daily-cloudcode-pa.sandbox.googleapis.com'
])
export const ANTIGRAVITY_API_VERSION = 'v1internal'

export const ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS = Object.freeze(
  ANTIGRAVITY_BOOTSTRAP_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`
  )
)
export const ANTIGRAVITY_ONBOARD_USER_ENDPOINTS = Object.freeze(
  ANTIGRAVITY_BOOTSTRAP_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:onboardUser`
  )
)
export const ANTIGRAVITY_FETCH_AVAILABLE_MODELS_URLS = Object.freeze(
  ANTIGRAVITY_DISCOVERY_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`
  )
)

/** Cache lifetimes (mirrors the reference client). */
export const ANTIGRAVITY_SUBSCRIPTION_CACHE_TTL_MS = 5 * 60 * 1000
export const ANTIGRAVITY_QUOTA_CACHE_TTL_MS = 60 * 1000

/**
 * Client fingerprint sent to Google: the official Antigravity macOS desktop
 * build. The upstream backend expects the native Mac client regardless of the
 * host OS (this is what every working third-party client does), so the
 * OS/arch token is pinned to darwin/arm64.
 */
export const ANTIGRAVITY_OS_TYPE = 'darwin'
export const ANTIGRAVITY_ARCH = 'arm64'
export const ANTIGRAVITY_IDE_VERSION = '2.1.1'

export const ANTIGRAVITY_ENVELOPE_USER_AGENT = 'antigravity'
