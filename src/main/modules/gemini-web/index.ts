import type { AntigravityMessage } from '../antigravity/transport'
import {
  GEMINI_WEB_MODELS as WEB_MODEL_DEFS,
  GeminiWebError,
  type GeminiWebModel
} from './protocol'
import {
  sendViaPage,
  probeGeminiWebModels,
  hasGeminiWebSession,
  closeWorker,
  resetChatSession,
  GeminiWebLoginError,
  type GeminiWebProbeEntry
} from './page-client'
import { loginToGeminiWeb, logoutGeminiWeb } from './login'
import { loadGeminiWeb, saveGeminiWeb, clearGeminiWeb } from './storage'

/**
 * The Gemini-web provider: a second translation backend alongside Antigravity.
 *
 * WHY BOTH: Antigravity stopped offering the newest Gemini models to this
 * account, while the same models are live on the Gemini web app. This provider
 * reaches those — including Argon — and Antigravity stays the default so an
 * existing signed-in user notices nothing.
 *
 * Model ids are namespaced (`gweb:argon`) so one model list can carry both
 * providers without a lookup table, and so an id is self-describing in the log.
 *
 * HOW IT WORKS: the request is executed inside a hidden gemini.google.com page
 * (see page-client.ts) rather than from the main process. That is not a
 * stylistic choice — it is the difference between working and a persistent
 * HTTP 400. A same-origin fetch gets the cookies and a genuine Chrome TLS
 * fingerprint for free, and reads the session tokens live at call time instead
 * of caching ones that expire.
 */

const PREFIX = 'gweb:'

/** The model list shown in the picker, one entry per real model. */
export const GEMINI_WEB_MODELS: { id: string; name: string; model: GeminiWebModel }[] =
  WEB_MODEL_DEFS.map((m) => ({
    id: `${PREFIX}${m.name.replace(/^Gemini\s+/i, '').toLowerCase().replace(/\s+/g, '-')}`,
    name: `${m.name} (Gemini web)`,
    model: m
  }))

/** True when this model id should be served by the Gemini-web provider. */
export function isGeminiWebModel(modelId: string): boolean {
  return typeof modelId === 'string' && modelId.startsWith(PREFIX)
}

/** The model definition for a `gweb:` id, or null when the id is not ours. */
export function modelForModelId(modelId: string): GeminiWebModel | null {
  if (!isGeminiWebModel(modelId)) return null
  return GEMINI_WEB_MODELS.find((m) => m.id === modelId)?.model ?? null
}

export interface GeminiWebSendResult {
  text: string
}

/**
 * Send a translation turn.
 *
 * The message shape is reused from the Antigravity path (a single user turn
 * plus an optional system instruction) because the engine builds it once. The
 * two providers differ only in how that text reaches the model — so the system
 * instruction is prepended into the prompt rather than dropped, since this
 * endpoint has no separate system slot.
 */
export async function sendViaGeminiWeb(params: {
  modelId: string
  messages: AntigravityMessage[]
  systemInstruction?: string
  abortSignal?: AbortSignal
}): Promise<GeminiWebSendResult> {
  const model = modelForModelId(params.modelId)
  if (!model) {
    throw new GeminiWebError(`Unknown Gemini web model "${params.modelId}".`, 'unknown_model')
  }

  const userText = params.messages.map((m) => m.parts.map((p) => p.text).join('')).join('\n\n')

  const prompt = params.systemInstruction
    ? `${params.systemInstruction}\n\n${userText}`
    : userText

  const text = await sendViaPage({
    prompt,
    mode: model.number,
    modelId: model.id,
    signal: params.abortSignal
  })

  return { text }
}

// ── Account state (mirrors the Antigravity provider's shape) ────────────────

export interface GeminiWebStatus {
  signedIn: boolean
  email?: string
  /** True when the OS keyring can store the session between launches. */
  canPersist: boolean
}

export async function getGeminiWebStatus(): Promise<GeminiWebStatus> {
  const { canPersistGeminiWeb } = await import('./storage')
  const live = await hasGeminiWebSession().catch(() => false)
  const stored = loadGeminiWeb()
  return {
    signedIn: live || Boolean(stored),
    email: stored?.email,
    canPersist: canPersistGeminiWeb()
  }
}

export async function connectGeminiWeb(
  parent?: Electron.BrowserWindow | null
): Promise<GeminiWebStatus> {
  const result = await loginToGeminiWeb(parent)
  saveGeminiWeb(result.credentials, { email: result.email, buildId: result.buildId })
  return { signedIn: true, email: result.email, canPersist: true }
}

export async function disconnectGeminiWeb(): Promise<void> {
  await logoutGeminiWeb()
  await closeWorker()
  clearGeminiWeb()
}

/**
 * Ask Google which models this account can actually reach.
 *
 * The model behind a tier is chosen server-side, so the only truthful answer to
 * "do I have Argon?" is to try it. Surfaced in Advanced so the user can check
 * before trusting a long translation to it.
 */
export async function probeGeminiWebModes(): Promise<GeminiWebProbeEntry[]> {
  if (!(await hasGeminiWebSession())) {
    throw new GeminiWebError('Not signed in to Gemini web.', 'not_signed_in')
  }
  return probeGeminiWebModels()
}

export { GeminiWebError, GeminiWebLoginError, resetChatSession }
