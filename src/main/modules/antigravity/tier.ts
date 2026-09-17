/**
 * Tier resolution for Antigravity accounts.
 *
 * `loadCodeAssist` returns BOTH:
 *   currentTier — the tier currently in effect for the base product. For a
 *                 paying subscriber this is still `free-tier` ("Antigravity"),
 *                 because it describes the free Antigravity surface itself.
 *   paidTier    — the actual paid subscription (e.g. `g1-pro-tier`,
 *                 "Google AI Pro"). Absent for genuinely free accounts.
 *
 * Reading only `currentTier` therefore reports every paying user as "Free".
 * Always prefer `paidTier` when present, and fall back to `currentTier`.
 */

export interface TierInfo {
  id: string
  name?: string
}

/** Pick the tier that actually describes the user's entitlement. */
export function extractTier(data: Record<string, unknown>): TierInfo | null {
  const paid = asTier(data.paidTier)
  if (paid) return paid

  const current = asTier(data.currentTier)
  if (current) return current

  const allowedTiers = data.allowedTiers
  if (Array.isArray(allowedTiers)) {
    // Prefer the entry flagged as default.
    for (const raw of allowedTiers) {
      const tier = asTier(raw)
      if (tier && (raw as Record<string, unknown>)?.isDefault === true) return tier
    }
    for (const raw of allowedTiers) {
      const tier = asTier(raw)
      if (tier) return tier
    }
  }

  const subscription = data.subscription as Record<string, unknown> | undefined
  if (subscription?.tier && typeof subscription.tier === 'string') {
    return { id: subscription.tier }
  }

  return null
}

function asTier(raw: unknown): TierInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id.trim() : ''
  if (!id) return null
  const name = typeof obj.name === 'string' ? obj.name.trim() : undefined
  return { id, name: name || undefined }
}

/**
 * Human-readable plan label. Prefers the tier's own display name (e.g.
 * "Google AI Pro") since Google keeps that current; otherwise maps the id.
 */
export function planLabelFromTier(tier: TierInfo | null): string {
  if (!tier) return 'Free'
  const upper = tier.id.toUpperCase()
  if (upper.includes('ULTRA')) return tier.name || 'Ultra'
  if (upper.includes('PRO') || upper.includes('PREMIUM') || upper.includes('GOOGLE_ONE')) {
    return tier.name || 'Pro'
  }
  if (upper.includes('ENTERPRISE')) return tier.name || 'Enterprise'
  if (upper.includes('BUSINESS') || upper.includes('STANDARD')) return tier.name || 'Business'
  if (upper.includes('PLUS')) return tier.name || 'Plus'
  if (upper.includes('LITE')) return tier.name || 'Lite'
  // A named non-free tier we don't recognise: show its name rather than "Free".
  if (tier.name && !/free/i.test(tier.name) && !/free/i.test(tier.id)) return tier.name
  return 'Free'
}
