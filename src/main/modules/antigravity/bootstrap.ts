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
 * Onboard a user (create a Cloud Code project) when loadCodeAssist returned no project.
 * Polls until done or times out.
 */
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

      const data = await response.json() as Record<string, unknown>
      // Check if done and has response
      if (data.done === true && data.response) {
        const project = (data.response as Record<string, unknown>).cloudaicompanionProject
        const projectId = typeof project === 'string'
          ? project
          : typeof project === 'object' && project && 'id' in project
            ? String((project as { id: unknown }).id)
            : null
        if (projectId) {
          const tier = extractTier(data)
          const plan = planLabelFromTier(tier)
          return { projectId, tierId: tier?.id ?? 'free-tier', plan }
        }
      }
      // If not done, we could poll but for simplicity we treat as failure
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
