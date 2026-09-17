import type { AntigravityModel } from '@shared/types'

/**
 * Preferred model for translation. Matches ANTIGRAVITY_DEFAULT_MODEL_ID on the
 * main side — kept as a literal here because the renderer can't import from the
 * main process module.
 */
export const PREFERRED_MODEL_ID = 'gemini-3.1-pro-low'

const isPro = (m: AntigravityModel): boolean =>
  /(^|[-_])pro([-_]|$)/i.test(m.id) || /\bpro\b/i.test(m.name)

const isFlash = (m: AntigravityModel): boolean => /flash/i.test(m.id) || /flash/i.test(m.name)

/**
 * Choose the model to use without asking.
 *
 * Order of preference:
 *   1. The exact preferred id (Gemini 3.1 Pro, Low).
 *   2. Any Pro that is NOT a Flash variant — Flash ids often contain "pro" in
 *      a version string (e.g. a "3.7-pro" tier), so Flash has to be excluded
 *      explicitly rather than relying on the id alone.
 *   3. Any remaining Pro.
 *   4. Whatever the account offers first, so translating is never blocked.
 *
 * Returning a fallback rather than null is deliberate: a free account with no
 * Pro access should still be able to translate, not be stuck on a dead picker.
 */
export function pickAutoModel(models: AntigravityModel[]): string | null {
  if (models.length === 0) return null

  const preferred = models.find((m) => m.id === PREFERRED_MODEL_ID)
  if (preferred) return preferred.id

  const pros = models.filter(isPro)
  const proNonFlash = pros.filter((m) => !isFlash(m))
  if (proNonFlash.length > 0) return proNonFlash[0].id
  if (pros.length > 0) return pros[0].id

  return models[0].id
}

/** Human label for the auto-chosen model, for the Advanced panel. */
export function describeAutoChoice(models: AntigravityModel[]): string {
  const id = pickAutoModel(models)
  if (!id) return 'No model available'
  return models.find((m) => m.id === id)?.name ?? id
}
