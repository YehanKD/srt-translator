import type { ModelInfo } from '@shared/types'

function normalizeEndpoint(url: string): string {
  return url.replace(/\/+$/, '')
}

function buildUrl(endpointUrl: string, path: string): string {
  const base = normalizeEndpoint(endpointUrl)
  if (base.endsWith('/v1')) return `${base}${path}`
  return `${base}/v1${path}`
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface ModelsResponse {
  data?: Array<{ id: string; owned_by?: string }>
}

export async function fetchModels(endpointUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const url = buildUrl(endpointUrl, '/models')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    let errorMsg = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errorBody)
      errorMsg = parsed.error?.message || parsed.message || errorMsg
    } catch {}
    throw new ApiError(errorMsg, response.status)
  }

  const data = (await response.json()) as ModelsResponse | ModelInfo[]

  if (Array.isArray(data)) return data.map(m => ({ id: m.id, owned_by: m.owned_by }))
  if (data.data && Array.isArray(data.data)) return data.data.map(m => ({ id: m.id, owned_by: m.owned_by }))

  throw new Error('Unexpected response format from /v1/models')
}

interface ChatCompletionParams {
  endpointUrl: string
  apiKey: string
  modelId: string
  messages: Array<{ role: string; content: string }>
  signal?: AbortSignal
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export async function sendChatCompletion(params: ChatCompletionParams): Promise<string> {
  const { endpointUrl, apiKey, modelId, messages, signal } = params
  const url = buildUrl(endpointUrl, '/chat/completions')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelId, messages, temperature: 0, stream: false }),
    signal
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    let errorMsg = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errorBody)
      errorMsg = parsed.error?.message || parsed.message || errorMsg
    } catch {}
    throw new ApiError(errorMsg, response.status)
  }

  const data = (await response.json()) as ChatCompletionResponse
  return data.choices?.[0]?.message?.content ?? ''
}

export async function* sendChatCompletionStream(
  params: ChatCompletionParams
): AsyncGenerator<string> {
  const { endpointUrl, apiKey, modelId, messages, signal } = params
  const url = buildUrl(endpointUrl, '/chat/completions')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelId, messages, temperature: 0, stream: true }),
    signal
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    let errorMsg = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errorBody)
      errorMsg = parsed.error?.message || parsed.message || errorMsg
    } catch {}
    throw new ApiError(errorMsg, response.status)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {}
      }
    }
  } finally {
    reader.releaseLock()
  }
}
