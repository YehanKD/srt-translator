/**
 * Renderer-side model helpers.
 *
 * The ranking rules live in `@shared/models` so the main process and the
 * renderer cannot drift apart. This module only re-exports what the UI needs,
 * plus the display-label helper.
 */
import type { AntigravityModel } from '@shared/types'
import { pickAutoModel, sortModelsForDisplay } from '@shared/models'

export { pickAutoModel, sortModelsForDisplay }

/** Human label for the auto-chosen model, for the Advanced panel. */
export function describeAutoChoice(models: AntigravityModel[]): string {
  const id = pickAutoModel(models)
  if (!id) return 'No model available'
  return models.find((m) => m.id === id)?.name ?? id
}
