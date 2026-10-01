import type { ModelQuota, QuotaSummary } from '@shared/types'

/**
 * The single most constrained model drives any headline number, because that's
 * the one that will stop you working. A bare chart of several models told the
 * user nothing; a percentage plus a name is the useful summary.
 */
export function tightest(models: QuotaSummary['models']): ModelQuota | null {
  const reported = models.filter((m) => !m.unlimited && m.fractionReported)
  if (reported.length === 0) return null
  return reported.reduce((min, m) =>
    m.remainingPercentage < min.remainingPercentage ? m : min
  )
}

/**
 * Quota for one specific model.
 *
 * The header must report the model this app actually translates with. Taking
 * the *tightest* across every model was wrong: an account also reports Claude
 * and GPT models it may never have touched, and one of those sitting at 0%
 * made the bar read "0% left" while the Gemini model in use was at 100%.
 * The reset time was wrong for the same reason.
 */
export function quotaForModel(
  models: QuotaSummary['models'],
  modelId: string | null | undefined
): ModelQuota | null {
  if (!modelId) return null
  const match = models.find((m) => m.id === modelId)
  if (!match || match.unlimited || !match.fractionReported) return null
  return match
}

/** Compact countdown: "45m", "3h 13m", "2d". */
export function relativeReset(resetAt: string | null): string | null {
  if (!resetAt) return null
  const ms = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const totalMins = Math.round(ms / 60000)
  if (totalMins < 60) return `${totalMins}m`
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Meter colour reflects urgency: calm teal, then amber, then red. */
export function meterColor(pct: number): string {
  if (pct < 10) return 'var(--color-danger)'
  if (pct < 30) return 'var(--color-warning)'
  return 'var(--color-accent-bright)'
}
