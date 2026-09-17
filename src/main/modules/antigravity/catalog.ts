import type { AntigravityModel } from '@shared/types'

/**
 * Static catalog of user-callable Antigravity chat models (display names,
 * context caps). The authenticated `:fetchAvailableModels` response is the
 * live source of truth for what an account may actually call; this list is the
 * fallback catalog (offline, or when the RPC is unavailable) and the name map.
 */
export const ANTIGRAVITY_PUBLIC_MODELS: readonly AntigravityModel[] = Object.freeze([
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash (Medium)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'gemini-3.7-flash-tiered', name: 'Gemini 3.7 Flash (Tiered)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)', contextLength: 1048576, maxOutputTokens: 65535 },
  { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)', contextLength: 1048576, maxOutputTokens: 65535 },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', contextLength: 1048576, maxOutputTokens: 65535 },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)', contextLength: 1048576, maxOutputTokens: 65536 },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', contextLength: 131072, maxOutputTokens: 32768 }
])

export const ANTIGRAVITY_DEFAULT_MODEL_ID = 'gemini-3.1-pro-low'

const MODEL_NAME_MAP: Record<string, string> = Object.fromEntries(
  ANTIGRAVITY_PUBLIC_MODELS.map((m) => [m.id, m.name])
)

/** Upstream id resolution (display tier → live upstream id). */
export const ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  'gemini-3.7-flash': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-high': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-medium': 'gemini-3.7-flash-tiered',
  'gemini-3.7-flash-low': 'gemini-3.7-flash-tiered',
  'gpt-oss-120b': 'gpt-oss-120b-medium',
  // gemini-3.1-pro-low is accepted verbatim upstream (no alias).
  'gemini-3.1-pro-high': 'gemini-pro-agent',
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
  'gemini-claude-sonnet-4-5': 'claude-sonnet-4-6',
  'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-6',
  'gemini-claude-opus-4-5-thinking': 'claude-opus-4-6-thinking'
}

/** Per-request fallback chain when the requested upstream id 400s. */
const ANTIGRAVITY_PRO_FALLBACK_CHAINS: Record<string, string[]> = {
  'gemini-3.1-pro-low': ['gemini-3.1-pro-low', 'gemini-3-pro-low']
}

/** Retired/hidden preview ids that must never be offered. */
const ANTIGRAVITY_DROPPED_MODEL_IDS = new Set<string>([
  'gemini-3-pro-preview',
  'gemini-3.1-pro',
  'gemini-2.5-pro',
  'gemini-2.5-flash-thinking',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-preview'
])

const NON_CHAT_PATTERN = /(?:^|[-_])(image|imagen|audio|tts|embedding|embed|video|veo)(?:[-_]|$)/i

export function resolveAntigravityModelId(modelId: string): string {
  if (!modelId) return modelId
  return ANTIGRAVITY_MODEL_ALIASES[modelId] || modelId
}

export function getAntigravityModelName(id: string, fallback?: string): string {
  return MODEL_NAME_MAP[id] || fallback || id
}

export function getAntigravityModelFallbacks(modelId: string): readonly string[] {
  return ANTIGRAVITY_PRO_FALLBACK_CHAINS[modelId] ?? []
}

/** Live-catalog eligibility for chat (accounts never see image/tts/etc.). */
export function isDiscoverableAntigravityModelId(modelId: string): boolean {
  const id = (modelId || '').trim()
  if (!id || ANTIGRAVITY_DROPPED_MODEL_IDS.has(id)) return false
  return !NON_CHAT_PATTERN.test(id)
}

/** Pick the account's best available chat models for the picker. */
export function pickChatModels(ids: string[]): AntigravityModel[] {
  const seen = new Set<string>()
  const out: AntigravityModel[] = []
  for (const raw of ids) {
    const id = resolveAntigravityModelId(String(raw || '').trim())
    if (!id || seen.has(id) || !isDiscoverableAntigravityModelId(id)) continue
    seen.add(id)
    out.push({ id, name: getAntigravityModelName(id), ...(MODEL_META[id] ?? {}) })
  }
  return out
}

const MODEL_META: Record<string, Pick<AntigravityModel, 'contextLength' | 'maxOutputTokens'>> =
  Object.fromEntries(
    ANTIGRAVITY_PUBLIC_MODELS.map((m) => [
      m.id,
      { contextLength: m.contextLength, maxOutputTokens: m.maxOutputTokens }
    ])
  )
