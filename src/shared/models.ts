import type { AntigravityModel } from './types'

/**
 * Model ranking, shared by the main process and the renderer.
 *
 * WHY THIS IS SHARED: the two sides used to decide independently — the renderer
 * auto-picked from a hardcoded `PREFERRED_MODEL_ID`, and the main process had
 * its own `ANTIGRAVITY_DEFAULT_MODEL_ID`. Two copies of the same rule drift, and
 * a pinned literal means a newly released model is never used: the pin keeps
 * winning as long as that exact id is still offered.
 *
 * The rule here is version-based instead, so a new model is adopted the moment
 * the account reports it, with no app update.
 */

/**
 * Parse the version out of a model id: "gemini-3.1-pro-low" -> 3.01,
 * "gemini-4-argon-pro" -> 4, "gemini-pro-agent" -> -1 (none).
 *
 * Minor versions are folded in as hundredths so plain numeric comparison is
 * enough (3.1 -> 3.01, 4 -> 4.00). Ids with no version rank below versioned
 * ones, which is what we want for legacy aliases like `gemini-pro-agent`.
 */
export function parseModelVersion(id: string): number {
  const m = (id || '').match(/(?:^|[-_])(\d+)(?:\.(\d+))?(?=[-_]|$)/)
  if (!m) return -1
  const major = Number.parseInt(m[1], 10)
  if (!Number.isFinite(major)) return -1
  const minor = m[2] ? Number.parseInt(m[2], 10) : 0
  return major + (Number.isFinite(minor) ? minor : 0) / 100
}

/** A Flash variant — faster and cheaper, but not what we want to translate with. */
export function isFlashModel(m: Pick<AntigravityModel, 'id' | 'name'>): boolean {
  return /flash/i.test(m.id) || /flash/i.test(m.name || '')
}

/**
 * A Pro tier. Matched on a whole segment so `-pro-` counts but a substring does
 * not; Flash ids can carry "pro" inside a version string, which isFlashModel
 * excludes separately.
 */
export function isProModel(m: Pick<AntigravityModel, 'id' | 'name'>): boolean {
  return /(?:^|[-_])pro(?:[-_]|$)/i.test(m.id) || /\bpro\b/i.test(m.name || '')
}

/** Gemini-family models are this app's well-tested path. */
export function isGeminiModel(m: Pick<AntigravityModel, 'id' | 'name'>): boolean {
  return /gemini/i.test(m.id) || /gemini/i.test(m.name || '')
}

/** Ranking key, highest wins. Exported for tests. */
export function modelScore(m: Pick<AntigravityModel, 'id' | 'name'>): number[] {
  const gemini = isGeminiModel(m) ? 1 : 0
  const pro = isProModel(m) ? 1 : 0
  const flash = isFlashModel(m) ? 1 : 0
  const proNonFlash = pro && !flash ? 1 : 0
  return [
    gemini && proNonFlash ? 1 : 0, // a Gemini Pro — the ideal
    proNonFlash, // any other Pro
    gemini, // else prefer the Gemini family
    parseModelVersion(m.id)
  ]
}

/** Compare two models, best first. Stable: equal scores keep input order. */
export function compareModels(
  a: Pick<AntigravityModel, 'id' | 'name'>,
  b: Pick<AntigravityModel, 'id' | 'name'>
): number {
  const sa = modelScore(a)
  const sb = modelScore(b)
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sb[i] - sa[i]
  }
  return 0
}

/**
 * Choose the model to translate with, without asking.
 *
 * Picks the NEWEST Gemini Pro the account offers, so a newly released model is
 * adopted automatically. Falls back through any Pro, then any Gemini, then
 * whatever exists — translating must never be blocked by a model list.
 *
 * Returns null only when the account reports no models at all.
 */
export function pickAutoModel(models: AntigravityModel[]): string | null {
  if (!models || models.length === 0) return null
  // toSorted keeps the input array untouched; equal scores preserve order.
  return [...models].sort(compareModels)[0].id
}

/**
 * Order the picker list best-first so new models surface at the top instead of
 * wherever the account happened to list them.
 */
export function sortModelsForDisplay(models: AntigravityModel[]): AntigravityModel[] {
  return [...models].sort(compareModels)
}

/** Acronyms that should not be title-cased into "Gpt"/"Oss". */
const ACRONYMS = new Set(['gpt', 'oss', 'ai', 'tts', 'api'])

/**
 * Human-readable name for a model we have no catalog entry for.
 *
 * Without this a newly released model shows as a raw id like
 * "gemini-4-argon-pro" in the picker, which reads like a bug.
 */
export function prettyModelName(id: string): string {
  const cleaned = (id || '').trim()
  if (!cleaned) return 'Unknown model'
  return cleaned
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (ACRONYMS.has(lower)) return part.toUpperCase()
      // Parameter sizes: "120b" -> "120B", "8b" -> "8B" (but leave "3.1" alone).
      if (/^\d+[bmk]$/.test(lower)) return lower.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}
