import { useState, useEffect } from 'react'
import { useModels } from '../hooks/useModels'
import { ModelSelector } from './ModelSelector'
import type { ApiSettings } from '@shared/types'

const SETTINGS_STORAGE_KEY = 'srt-translator-settings'

interface Props {
  settings: ApiSettings
  onChange: (settings: ApiSettings) => void
}

export function SettingsPanel({ settings, onChange }: Props) {
  const { models, loading, error, fetchModels } = useModels()
  const [showKey, setShowKey] = useState(false)

  // Autosave the FULL config — endpoint, key AND selected model — on every
  // change, so closing and reopening the app restores exactly what was used.
  const persist = (next: ApiSettings) => {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({ endpointUrl: next.endpointUrl, apiKey: next.apiKey, modelId: next.modelId })
      )
    } catch {
      /* storage unavailable — settings just won't survive a restart */
    }
  }

  const handleSave = (updates: Partial<ApiSettings>) => {
    const next = { ...settings, ...updates }
    onChange(next)
    persist(next)
  }

  // Restore the saved config (endpoint + key + model) on launch.
  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.endpointUrl || parsed.modelId) {
          onChange({
            ...settings,
            endpointUrl: parsed.endpointUrl ?? '',
            apiKey: parsed.apiKey ?? '',
            modelId: parsed.modelId ?? ''
          })
        }
      } catch {
        /* corrupt saved config — start fresh */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConnect = () => {
    if (!settings.endpointUrl) return
    fetchModels(settings.endpointUrl, settings.apiKey)
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">API Configuration</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Endpoint URL</label>
          <input
            type="text"
            value={settings.endpointUrl}
            onChange={e => handleSave({ endpointUrl: e.target.value })}
            placeholder="https://api.groq.com/openai or http://localhost:11434/v1"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={e => handleSave({ apiKey: e.target.value })}
              placeholder="sk-... (leave empty for local models)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-16 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-3 py-1"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !settings.endpointUrl}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
        >
          {loading ? 'Connecting...' : 'Connect & Load Models'}
        </button>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {models.length > 0 && (
          <ModelSelector
            models={models}
            selected={settings.modelId}
            onChange={modelId => handleSave({ modelId })}
          />
        )}
      </div>
    </div>
  )
}
