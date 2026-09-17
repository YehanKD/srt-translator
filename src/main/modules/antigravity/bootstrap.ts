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

      const data = await response.json() as Record<string, unknown>
      const project = data.cloudaicompanionProject
      const projectId = typeof project === 'string'
        ? project
        : typeof project === 'object' && project && 'id' in project
          ? String((project as { id: unknown }).id)
          : null

      if (!projectId) return null

      const tier = extractTier(data)
      const plan = planLabelFromTier(tier)

      return { projectId, tierId: tier?.id ?? 'free-tier', plan }
    } catch {
      // try next endpoint
    }
  }
  return null
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

/** Pull a project id out of whatever shape the API returns. */
function readProjectId(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && 'id' in value) {
    const id = String((value as { id: unknown }).id)
    return id || null
  }
  return null
}

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

export async function onboardUser(
  accessToken: string,
  tierId = 'free-tier'
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

      let data = (await response.json()) as Record<string, unknown>

      // A fast path: some accounts come back already done.
      const immediate = projectFromOperation(data)
      if (data.done === true && immediate) return immediate

      // The usual path: an operation name to poll. Without this the project is
      // never created and sign-in fails for new accounts.
      const operationName = typeof data.name === 'string' ? data.name : null
      if (!operationName) {
        // No name and not done — nothing to poll, so try the next endpoint.
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
 */
export async function fetchUserInfo(accessToken: string): Promise<{ email: string; picture?: string } | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) return null
    const data = await response.json() as { email?: string; picture?: string }
    if (!data.email) return null
    return { email: data.email, picture: data.picture }
  } catch {
    return null
  }
}
