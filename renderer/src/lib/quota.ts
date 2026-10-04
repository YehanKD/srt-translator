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

/**
 * Detect a reset time that cannot count down.
 *
 * MEASURED BEHAVIOUR (Gemini, Oct 2026): while a 5-hour window is untouched,
 * Google reports `resetTime = now + 5h` on every call. Sampling 96 seconds apart
 * moved the reset time forward by exactly 96 seconds, so the countdown stayed
 * pinned at "5h" forever. After the first translation opened the window, the
 * same field moved forward only 1 second in 37 seconds — a real fixed timestamp.
 *
 * So a reset time is only trustworthy once it has STOPPED tracking the clock.
 * The give-away is that it sits almost exactly one full window ahead: a genuine
 * timestamp drifts toward now as time passes, while a placeholder stays a
 * constant distance away.
 *
 * @param resetAt      the ISO time the API reported
 * @param windowHours  the window length in hours (5 for the rolling limit)
 * @param toleranceMs  how close to exactly one window counts as "placeholder"
 */
export function isRollingPlaceholder(
  resetAt: string | null,
  windowHours = 5,
  toleranceMs = 5 * 60 * 1000
): boolean {
  if (!resetAt) return false
  const ms = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(ms)) return false
  return Math.abs(ms - windowHours * 3600 * 1000) <= toleranceMs
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

/**
 * The account's window of a given kind for a model's family.
 *
 * Windows are keyed by family because Claude and GPT models draw on a SEPARATE
 * pool from Gemini — reading a Gemini reset for a Claude model would report a
 * limit that model does not use.
 */
export function windowFor<T extends { key: string; window?: string }>(
  modelId: string | null | undefined,
  weekly: T[],
  window: '5h' | 'weekly'
): T | null {
  if (!weekly?.length) return null
  const family = /claude|gpt/i.test(modelId ?? '') ? 'claude_gpt' : 'gemini'
  return weekly.find((w) => w.key.startsWith(family) && w.window === window) ?? null
}

