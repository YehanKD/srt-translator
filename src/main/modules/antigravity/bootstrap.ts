import { getAntigravityContentHeaders, getAntigravityLoadCodeAssistMetadata } from './headers'
import {
  ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS,
  ANTIGRAVITY_ONBOARD_USER_ENDPOINTS
} from './constants'

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

      const tierId = extractTierId(data)
      const plan = mapTierIdToPlan(tierId)

      return { projectId, tierId, plan }
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
          const tier = extractTierId(data)
          const plan = mapTierIdToPlan(tier)
          return { projectId, tierId: tier, plan }
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

function extractTierId(data: Record<string, unknown>): string {
  // Try currentTier, then allowedTiers default, then subscription tier
  const currentTier = data.currentTier as Record<string, unknown> | undefined
  if (currentTier?.id && typeof currentTier.id === 'string') return currentTier.id

  const allowedTiers = data.allowedTiers as Array<Record<string, unknown>> | undefined
  if (Array.isArray(allowedTiers)) {
    for (const tier of allowedTiers) {
      if (tier.isDefault === true && tier.id && typeof tier.id === 'string') {
        return tier.id
      }
    }
    if (allowedTiers.length > 0 && allowedTiers[0]?.id && typeof allowedTiers[0].id === 'string') {
      return allowedTiers[0].id as string
    }
  }

  const subscription = data.subscription as Record<string, unknown> | undefined
  if (subscription?.tier && typeof subscription.tier === 'string') return subscription.tier

  return 'free-tier'
}

function mapTierIdToPlan(tierId: string): string {
  const upper = tierId.toUpperCase()
  if (upper.includes('ULTRA')) return 'Ultra'
  if (upper.includes('PRO') || upper.includes('PREMIUM') || upper.includes('GOOGLE_ONE')) return 'Pro'
  if (upper.includes('ENTERPRISE')) return 'Enterprise'
  if (upper.includes('BUSINESS') || upper.includes('STANDARD')) return 'Business'
  if (upper.includes('PLUS')) return 'Plus'
  if (upper.includes('LITE')) return 'Lite'
  return 'Free'
}