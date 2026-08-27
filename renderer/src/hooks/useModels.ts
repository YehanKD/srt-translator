import { useState, useCallback } from 'react'
import type { ModelInfo } from '@shared/types'

const MODELS_STORAGE_KEY = 'srt-translator-models'

// Keep the last fetched model list around so a restart can repopulate the
// dropdown (and restore the selected model) without re-connecting.
function loadSavedModels(): ModelInfo[] {
  try {
    const raw = localStorage.getItem(MODELS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ModelInfo[]) : []
  } catch {
    return []
  }
}

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>(loadSavedModels)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = useCallback(async (endpointUrl: string, apiKey: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.fetchModels(endpointUrl, apiKey)
      if (result.success) {
        const list = result.data as ModelInfo[]
        setModels(list)
        try {
          localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(list))
        } catch {
          /* storage unavailable — models just won't survive a restart */
        }
      } else {
        setError(result.error || 'Failed to fetch models')
        setModels([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [])

  return { models, loading, error, fetchModels }
}
