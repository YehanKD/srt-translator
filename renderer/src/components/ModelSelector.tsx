import type { ModelInfo } from '@shared/types'

interface Props {
  models: ModelInfo[]
  selected: string
  onChange: (modelId: string) => void
}

export function ModelSelector({ models, selected, onChange }: Props) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">Model</label>
      <select
        value={selected}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      >
        <option value="">Select a model...</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.id}{m.owned_by ? ` (${m.owned_by})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
