import { randomBytes } from 'crypto'
import { getAntigravityContentHeaders } from './headers'
import { ANTIGRAVITY_RUNTIME_BASE_URLS, ANTIGRAVITY_ENVELOPE_USER_AGENT } from './constants'
import { resolveAntigravityModelId, getAntigravityModelFallbacks } from './catalog'
import { getAccessToken, getSession } from './session'

export interface AntigravityMessage {
  role: 'user' | 'model'
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
}

export interface AntigravityRequest {
  model: string
  messages: AntigravityMessage[]
  systemInstruction?: string
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}

export interface AntigravityResponse {
  text: string
  finishReason: string
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export class AntigravityApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AntigravityApiError'
    this.status = status
  }
}

export class AntigravityModelError extends Error {
  modelId: string
  constructor(message: string, modelId: string) {
    super(message)
    this.name = 'AntigravityModelError'
    this.modelId = modelId
  }
}

const MAX_SSE_IDLE_MS = 180_000 // give up if no data line for this long
const REQUEST_TIMEOUT_MS = 300_000 // hard ceiling for a single request

function generateRequestId(): string {
  return `agent/${Date.now()}/${randomBytes(4).toString('hex')}`
}

function generateSessionId(): string {
  // Matches the reference client's negative session-id scheme.
  return `-${Math.floor(Math.random() * 9_000_000_000_000_000_000)}`
}

/**
 * Send a translation request to Antigravity's Code Assist streamGenerateContent
 * endpoint. The envelope (project / userAgent / requestType / nested request)
 * is required by the backend; a bare Gemini-style body is rejected or ignored.
 */
export async function sendAntigravityRequest(
  request: AntigravityRequest
): Promise<AntigravityResponse> {
  const accessToken = await getAccessToken()
  const session = getSession()
  if (!accessToken) {
    throw new AntigravityApiError('Not signed in to Antigravity. Please sign in again.', 401)
  }
  const projectId = session?.projectId
  if (!projectId) {
    throw new AntigravityApiError('No Cloud Code project found for this account. Re-sign in.', 403)
  }

  const upstreamModel = resolveAntigravityModelId(request.model)
  const requestId = generateRequestId()
  const sessionId = generateSessionId()

  const contents: AntigravityMessage[] = request.messages.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: m.parts.map((p) => ({ ...p }))
  }))

  // No temperature: thinking-tier models reject it. Reference client only
  // sets topK/topP/maxOutputTokens.
  const generationConfig: Record<string, unknown> = { topK: 40, topP: 1.0 }
  if (request.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = request.maxOutputTokens
  }

  const innerRequest: Record<string, unknown> = {
    model: upstreamModel,
    contents,
    generationConfig,
    sessionId
  }
  if (request.systemInstruction) {
    innerRequest.systemInstruction = { parts: [{ text: request.systemInstruction }] }
  }

  // Reference envelope — everything model-related lives under `request`.
  const body: Record<string, unknown> = {
    project: projectId,
    model: upstreamModel,
    userAgent: ANTIGRAVITY_ENVELOPE_USER_AGENT,
    requestType: 'agent',
    requestId,
    request: innerRequest
  }

  const headers: Record<string, string> = {
    ...getAntigravityContentHeaders(accessToken),
    Accept: 'text/event-stream'
  }

  let lastError: Error | null = null
  for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('Antigravity request timed out')), REQUEST_TIMEOUT_MS)
    // Combine the caller's abort with our timeout.
    const onCallerAbort = () => controller.abort(request.abortSignal?.reason)
    request.abortSignal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw classifyHttpError(response.status, text, request.model)
      }

      const result = await parseSSEStream(response)
      // A successful HTTP call that produced nothing is still a failure.
      if (!result.text.trim() && result.finishReason !== 'tool_calls') {
        throw new AntigravityApiError('Antigravity returned an empty response. The model may not be available on this account.', 500)
      }
      return result
    } catch (err) {
      lastError = err as Error
      // Model-unavailable and other 4xx errors are deterministic — the same
      // content will fail identically on every endpoint, so throw immediately.
      if (err instanceof AntigravityModelError) throw err
      if (err instanceof AntigravityApiError && err.status < 500) throw err
      // Network errors, timeouts, 429s and 5xx may be endpoint-specific:
      // try the next base URL before giving up.
      const isRetryable = err instanceof AntigravityApiError
        ? err.status === 429 || err.status >= 500
        : true // plain network error / aborted timeout
      if (!isRetryable) throw err
    } finally {
      clearTimeout(timeout)
      request.abortSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  throw lastError || new AntigravityApiError('All Antigravity endpoints failed', 502)
}

function classifyHttpError(status: number, bodyText: string, modelId: string): Error {
  const lower = bodyText.toLowerCase()
  const modelMentions = /model|not found|unavailable|does not exist|permission|entitlement/.test(lower)
  if (status === 400 && modelMentions) {
    return new AntigravityModelError(`Model "${modelId}" is not available on this account. Pick another model.`, modelId)
  }
  if (status === 403) {
    return new AntigravityApiError(`Access forbidden (403): ${trimError(bodyText, modelId)}`, 403)
  }
  if (status === 429) {
    return new AntigravityApiError(`Rate limited (429): ${trimError(bodyText, modelId)}`, 429)
  }
  return new AntigravityApiError(`Antigravity API error ${status}: ${trimError(bodyText, modelId)}`, status)
}

function trimError(text: string, modelId: string, max = 250): string {
  if (!text) return `Model "${modelId}" may not be available on this account.`
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
}

/**
 * Parse the SSE stream. Text arrives either as a top-level `markdown` field or
 * as `response.candidates[].content.parts[]`. Thinking parts (thought /
 * thoughtSignature) are excluded from the final text.
 */
async function parseSSEStream(response: Response): Promise<AntigravityResponse> {
  const reader = response.body?.getReader()
  if (!reader) throw new AntigravityApiError('No response body from Antigravity', 502)

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulatedText = ''
  let sawSignedText = ''
  let finishReason = 'stop'
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(data) as Record<string, unknown>
        } catch {
          continue
        }

        // In-stream error payloads (some errors come back as 200 + SSE error).
        const streamError = parsed.error || (parsed.response as Record<string, unknown> | undefined)?.error
        if (streamError) {
          const msg = typeof streamError === 'string' ? streamError : String((streamError as Record<string, unknown>).message || streamError)
          throw new AntigravityApiError(`Antigravity error: ${msg}`, 500)
        }

        const markdown =
          typeof parsed.markdown === 'string' ? parsed.markdown :
          typeof (parsed.response as Record<string, unknown> | undefined)?.markdown === 'string'
            ? (parsed.response as Record<string, unknown>).markdown as string
            : null
        if (markdown) accumulatedText += markdown

        const candidates = (parsed.response as Record<string, unknown> | undefined)?.candidates ?? parsed.candidates
        if (Array.isArray(candidates) && candidates.length > 0) {
          const candidate = candidates[0] as Record<string, unknown>
          if (candidate.finishReason) {
            finishReason = String(candidate.finishReason).toLowerCase()
          }
          const content = candidate.content as Record<string, unknown> | undefined
          const parts = Array.isArray(content?.parts) ? (content.parts as Array<Record<string, unknown>>) : []
          for (const part of parts) {
            if (typeof part.text === 'string' && !part.thought) {
              if (part.thoughtSignature) {
                sawSignedText += part.text
              } else {
                accumulatedText += part.text
              }
            }
          }
        }

        const metadata = (parsed.response as Record<string, unknown> | undefined)?.usageMetadata ?? parsed.usageMetadata
        if (metadata) {
          const m = metadata as Record<string, unknown>
          usage = {
            promptTokens: Number(m.promptTokenCount || 0),
            completionTokens: Number(m.candidatesTokenCount || 0),
            totalTokens: Number(m.totalTokenCount || 0)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Flush any remaining buffer line
  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    const data = tail.slice(5).trim()
    if (data !== '[DONE]') {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        const markdown =
          typeof parsed.markdown === 'string' ? parsed.markdown :
          typeof (parsed.response as Record<string, unknown> | undefined)?.markdown === 'string'
            ? (parsed.response as Record<string, unknown>).markdown as string
            : null
        if (markdown) accumulatedText += markdown
      } catch {
        // ignore
      }
    }
  }

  // Fall back to thoughtSignature-carrying parts when nothing else arrived.
  const text = accumulatedText || sawSignedText
  return { text, finishReason, usage }
}

/**
 * Try the per-request fallback chain (e.g. gemini-3.1-pro-low →
 * gemini-3-pro-low) only when the primary model id 400s as unavailable.
 */
export async function sendAntigravityWithFallback(
  request: AntigravityRequest
): Promise<AntigravityResponse> {
  const fallbacks = getAntigravityModelFallbacks(request.model)
  if (fallbacks.length === 0) {
    return sendAntigravityRequest(request)
  }

  let lastError: Error | null = null
  for (const fallbackId of fallbacks) {
    try {
      return await sendAntigravityRequest({ ...request, model: fallbackId })
    } catch (err) {
      lastError = err as Error
      if (!(err instanceof AntigravityModelError)) throw err
    }
  }
  throw lastError || new AntigravityApiError('No fallback model worked', 502)
}