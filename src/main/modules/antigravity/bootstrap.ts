import { getAntigravityContentHeaders, getAntigravityLoadCodeAssistMetadata } from './headers'
import {
  ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS,
  ANTIGRAVITY_ONBOARD_USER_ENDPOINTS
} from './constants'
import { extractTier, planLabelFromTier } from './tier'

export interface CodeAssistInfo {
  projectId: string
  tierId: string
  plan: string
  email?: string
}

/**
 * Call loadCodeAssist to fetch the user's Cloud Code project and tier.
 * Returns null if the account has no project (BYOP / needs onboarding).
 */
export async function loadCodeAssist(
  accessToken: string
): Promise<CodeAssistInfo | null> {
  const found = await discoverAccount(accessToken)
  if (!found.projectId) return null
  return {
    projectId: found.projectId,
    tierId: found.tierId ?? 'legacy-tier',
    plan: found.plan
  }
}

export interface AccountDiscovery {
  /** null when Google has not assigned a project to this account. */
  projectId: string | null
  /** The account's real tier, present even when there is no project. */
  tierId: string | null
  plan: string
  /** True when Google returned 200 but no project — BYOP, needs a GCP project. */
  requiresManualProject: boolean
}

/**
 * Discover the account's project and tier, WITHOUT failing when no project
 * exists.
 *
 * The tier is returned even with no project because onboardUser needs it: a
 * paid account onboarded as "free-tier" asks Google for the wrong tier. The
 * old code discarded the whole response when the project was missing, so the
 * tier was lost and every retry used a guessed value.
 */
export async function discoverAccount(accessToken: string): Promise<AccountDiscovery> {
  const headers = getAntigravityContentHeaders(accessToken)
  const metadata = getAntigravityLoadCodeAssistMetadata()

  for (const endpoint of ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ metadata }),
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) continue

      const data = (await response.json()) as Record<string, unknown>
      const projectId = readProjectId(data.cloudaicompanionProject)
      const tier = extractTier(data)
      const tierId = onboardTierId(data) ?? tier?.id ?? null

      return {
        projectId,
        tierId,
        plan: planLabelFromTier(tier),
        requiresManualProject: !projectId
      }
    } catch {
      // try next endpoint
    }
  }
  return { projectId: null, tierId: null, plan: 'Free', requiresManualProject: false }
}

/** Read a project id from the several shapes the API uses. */
function readProjectId(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object' && 'id' in value) {
    const id = String((value as { id: unknown }).id).trim()
    return id || null
  }
  return null
}

/**
 * Pick the tier id to send to onboardUser.
 *
 * OmniRoute sends the account's ACTUAL tier (paidTier -> currentTier ->
 * default allowedTier -> "legacy-tier"). Sending a hardcoded "free-tier" for a
 * paid account asks Google to onboard it at the wrong tier, which can be
 * refused. Mirrors OmniRoute's `extractCodeAssistOnboardTierId`.
 */
function onboardTierId(data: Record<string, unknown>): string | null {
  const tierIdOf = (raw: unknown): string | null => {
    if (!raw || typeof raw !== 'object') return null
    const id = (raw as { id?: unknown }).id
    return typeof id === 'string' && id.trim() ? id.trim() : null
  }

  const paid = tierIdOf(data.paidTier)
  if (paid) return paid

  // `ineligibleTiers` present means this account can't use currentTier.
  const ineligible = data.ineligibleTiers
  const restricted = Array.isArray(ineligible) && ineligible.length > 0

  if (!restricted) {
    const current = tierIdOf(data.currentTier)
    if (current) return current
  }

  if (Array.isArray(data.allowedTiers)) {
    for (const raw of data.allowedTiers) {
      if ((raw as Record<string, unknown>)?.isDefault === true) {
        const id = tierIdOf(raw)
        if (id) return id
      }
    }
  }

  const current = tierIdOf(data.currentTier)
  if (current) return current

  // OmniRoute's fallback — deliberately not "free-tier": a fresh account
  // onboards as a legacy-tier Code Assist user.
  return 'legacy-tier'
}

/**
 * Onboard a user (create a Cloud Code project) when loadCodeAssist returned no
 * project.
 *
 * `onboardUser` starts a LONG-RUNNING OPERATION. The first response is almost
 * always `{ name: 'operations/...', done: false }` — the project does not exist
 * yet. The original implementation read `done === true` once and, on anything
 * else, fell through to `return null`, which the sign-in flow reports as
 * "No Cloud Code project available for this account".
 *
 * That made sign-in fail for every account that needs onboarding (a Google
 * account that has never used Code Assist / Antigravity), while working fine
 * for accounts that already had a project. The failure looked account-specific
 * and therefore platform-specific, but the code path has nothing to do with the
 * OS — it only depends on whether the account is new.
 *
 * Now: start the operation, then poll until it reports done, with a bounded
 * timeout so a genuinely stuck operation still fails with a real message.
 */
const ONBOARD_POLL_INTERVAL_MS = 2000
const ONBOARD_TIMEOUT_MS = 60_000

/** Extract the project from a completed operation payload. */
function projectFromOperation(
  payload: Record<string, unknown>
): { projectId: string; tierId: string; plan: string } | null {
  const body =
    payload.response && typeof payload.response === 'object'
      ? (payload.response as Record<string, unknown>)
      : payload

  const projectId = readProjectId(body.cloudaicompanionProject)
  if (!projectId) return null

  // The tier can sit on either the operation or its response payload.
  const tier = extractTier(payload) ?? extractTier(body)
  return { projectId, tierId: tier?.id ?? 'free-tier', plan: planLabelFromTier(tier) }
}

/**
 * Onboard a user (create a Cloud Code project) when loadCodeAssist returned no
 * project.
 *
 * Two shapes exist in the wild and both are handled:
 *   - A long-running operation: `{ name: 'operations/...', done: false }`,
 *     which must be polled until done. Reading `done === true` once and giving
 *     up is what made sign-in fail for every fresh account.
 *   - A plain 200 with no project in the body, which means Google expects the
 *     account to bring its own GCP project (OmniRoute calls this BYOP). No
 *     amount of retrying fixes that, so it is reported distinctly.
 *
 * The tier id matters: OmniRoute sends the account's REAL tier. A hardcoded
 * "free-tier" asks Google to onboard a paid account at the wrong tier.
 */
export async function onboardUser(
  accessToken: string,
  tierId = 'legacy-tier'
): Promise<{ projectId: string; tierId: string; plan: string } | null> {
  const headers = getAntigravityContentHeaders(accessToken)
  const metadata = getAntigravityLoadCodeAssistMetadata()

  for (const endpoint of ANTIGRAVITY_ONBOARD_USER_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tier_id: tierId, metadata }),
        signal: AbortSignal.timeout(30000)
      })
      if (!response.ok) continue

      // Read as text first: the BYOP case is a valid 200 whose body has no
      // project anywhere in it, and we must tell that apart from success.
      const rawBody = await response.text()
      const hasProjectField = /cloudaicompanionProject/.test(rawBody)

      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>
      } catch {
        // Non-JSON 200 — falls through to the BYOP check below.
      }

      // A fast path: some accounts come back already done, and some return the
      // project directly with no operation at all. Accept either — a project
      // in the payload means success, and polling a non-existent operation
      // would just burn the timeout.
      const immediate = projectFromOperation(data)
      if (immediate && (data.done === true || typeof data.name !== 'string')) {
        return immediate
      }

      // The usual path: an operation name to poll. Without this the project is
      // never created and sign-in fails for new accounts.
      const operationName = typeof data.name === 'string' ? data.name : null
      if (!operationName) {
        // 200, no operation, no project: Google will not create one for this
        // account. Return a sentinel (empty projectId) the caller can detect.
        if (!hasProjectField) return { projectId: '', tierId, plan: 'Free' }
        continue
      }

      const deadline = Date.now() + ONBOARD_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, ONBOARD_POLL_INTERVAL_MS))

        const poll = await fetch(`${endpoint}/${operationName}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15000)
        })
        if (!poll.ok) continue

        data = (await poll.json()) as Record<string, unknown>
        if (data.done !== true) continue

        const result = projectFromOperation(data)
        if (result) return result

        // Done but no project — an error payload we can't act on; try the next
        // endpoint rather than reporting a misleading "no project".
        break
      }
    } catch {
      // try next endpoint
    }
  }
  return null
}

/**
 * Fetch user info (email) from Google.
 *
 * Best-effort: the email is a display label, not a credential. The caller must
 * NOT fail sign-in when this is unavailable — see fetchUserInfoWithFallback.
 *
 * Tries several endpoints because the OAuth2 userinfo surface has been moving:
 * `oauth2/v1/userinfo` is the legacy path, `oauth2/v2/userinfo` its successor,
 * and `openidconnect/v1/userinfo` the OpenID-Connect equivalent. A 401/403 from
 * one does not mean the token is bad — only that endpoint declined it.
 */
const USERINFO_ENDPOINTS = [
  'https://openidconnect.googleapis.com/v1/userinfo',
  'https://www.googleapis.com/oauth2/v2/userinfo',
  'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
]

const USERINFO_TIMEOUT_MS = 8000

export async function fetchUserInfo(
  accessToken: string
): Promise<{ email: string; picture?: string } | null> {
  for (const endpoint of USERINFO_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS)
      })
      if (!response.ok) continue

      const data = (await response.json()) as { email?: string; picture?: string }
      if (!data.email) continue

      return { email: data.email, picture: data.picture }
    } catch {
      // try the next endpoint
    }
  }
  return null
}

/**
 * Read the email out of an id_token (a JWT) without verifying it.
 *
 * This is a display label taken from a token Google just handed us over TLS —
 * not an authorization decision — so decoding the payload locally is safe and
 * avoids a network round-trip entirely. Used as the fallback when every
 * userinfo endpoint is unavailable.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const claims = JSON.parse(json) as { email?: string }
    return typeof claims.email === 'string' && claims.email ? claims.email : null
  } catch {
    return null
  }
}
