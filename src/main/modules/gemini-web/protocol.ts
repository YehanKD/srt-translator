import { randomUUID } from 'node:crypto'

/**
 * The Gemini web protocol, as PROVEN against a live account.
 *
 * HOW THIS WAS VERIFIED: the request was run inside the gemini.google.com page
 * (see page-client.ts) and returned HTTP 200 carrying the expected text. The
 * shape below is not inferred — it was diffed against the working reference
 * implementation (gemini_webapi/client.py) after twelve failed attempts, and
 * every failure traces to a difference in this payload.
 *
 * The four differences that mattered, each of which alone produced HTTP 400
 * error-3 with an EMPTY error detail:
 *
 *   1. The inner array is 81 SLOTS. A longer array (96) sends trailing nulls
 *      that the server treats as a malformed request.
 *   2. Slot [6] is [1], not [0].
 *   3. Slot [67] must NOT be set. Setting it adds a field the server does not
 *      expect.
 *   4. The form body is `at` FIRST, then `f.req`.
 *
 * WHY MODEL IDS ARE DISCOVERED, NOT HARDCODED: Google renumbers models. The
 * `gemini-pro` id this file originally carried (9d8ca3786ebdfbea) is already
 * stale — the account it was tested against reports e6fa609c3fa255c0. A
 * hardcoded table therefore selects the wrong model, or none. The list below is
 * a fallback; the account's real list is read at runtime.
 */

export const GEMINI_ORIGIN = 'https://gemini.google.com'

/**
 * The stored session.
 *
 * Retained because the login flow and the encrypted store both use it: the
 * cookies prove a session exists between launches, and `email` is shown in the
 * UI. The runtime request path no longer needs it — page-client.ts reads the
 * cookies from the live page instead — but the user must still be able to see
 * WHO is signed in without opening a window.
 */
export interface GeminiWebCredentials {
  /** Full cookie header, e.g. "__Secure-1PSID=…; __Secure-1PSIDTS=…". */
  cookie: string
  /** SAPISID, kept for the signed-in check and future use. */
  sapisid: string
  /** /u/<n> for a secondary Google account; '' for the default account. */
  accountPrefix?: string
}

export interface GeminiWebModel {
  /** Shown in the model picker. */
  name: string
  /** The 16-hex internal id, sent in the model header. */
  id: string
  /** The tier number, sent BOTH in the header tail and in payload slot [79]. */
  number: number
  /**
   * Capacity tail in the model header: 1 basic, 4 plus, 2 advanced. It encodes
   * which quota pool the request draws from, so it must match the account's
   * tier or Google answers from the wrong pool.
   */
  capacity: number
}

/**
 * Fallback list, read from the live account this was built against. Ordered
 * strongest first, so a picker defaults to the best model available.
 */
export const GEMINI_WEB_MODELS: GeminiWebModel[] = [
  { name: 'Gemini Argon', id: '95a4c0abcba24364', number: 8, capacity: 1 },
  { name: 'Gemini Pro', id: 'e6fa609c3fa255c0', number: 3, capacity: 1 },
  { name: 'Gemini Flash', id: '56fdd199312815e2', number: 1, capacity: 1 },
  { name: 'Gemini Flash Lite', id: '8c46e95b1a07cecc', number: 6, capacity: 1 }
]

/** Metadata block for slot [2]. Present but opaque; the server requires it. */
const DEFAULT_METADATA = ['', '', '', null, null, null, null, null, null, '']

/**
 * Thinking depth, slot [17] = [[thinkMode]]. 0 is deepest and 4 shallowest,
 * per the reference implementations. Translation wants 0: the model must hold
 * a whole chunk of dialogue and produce idiomatic Sinhala, which is exactly the
 * work depth helps.
 */
export const THINK_DEEPEST = 0

/**
 * Build the inner payload array, JSON-encoded, for `f.req`.
 *
 * Positional JSPB: a field's meaning is its INDEX, so only the meaningful slots
 * are set and the rest stay null. Filling them in with guesses is how these
 * payloads break — three of the four bugs above were exactly that.
 */
export function buildInnerPayload(
  prompt: string,
  mode: number,
  uuid: string,
  thinkMode: number = THINK_DEEPEST,
  chatMetadata?: string[] | null
): string {
  const a: unknown[] = new Array(81).fill(null)

  a[0] = [prompt, 0, null, null, null, null, 0]
  a[1] = ['en']
  // [2] continues an existing conversation. Sending the `[cid, rid]` pair the
  // previous reply returned keeps every chunk in ONE chat; leaving it as the
  // default metadata starts a new conversation per request, which fills the
  // history with hundreds of chats and gets the account rate limited.
  a[2] = chatMetadata ?? DEFAULT_METADATA
  a[6] = [1] // [1], not [0]
  a[7] = 1 // streaming
  a[10] = 1
  a[11] = 0
  a[17] = [[thinkMode]]
  a[18] = 0
  a[27] = 1
  a[30] = [4]
  a[41] = [1]
  a[53] = 0
  a[59] = uuid
  a[61] = []
  // [67] deliberately left null.
  a[68] = 1
  a[79] = mode
  a[80] = 1

  return JSON.stringify([null, JSON.stringify(a)])
}

/**
 * Pull the `[chatId, replyId]` pair out of a reply, for the next request.
 *
 * Every response carries the conversation's identifiers at inner[1]. Sending
 * them back in slot [2] appends to the SAME chat. Without this each request
 * starts a new conversation: a 500-cue job produced ~30 chats, and the account
 * was rate limited because of it.
 *
 * Returns null when no pair is present, which is the correct signal to start a
 * fresh conversation rather than sending a malformed continuation.
 */
export function parseChatMetadata(raw: string): string[] | null {
  for (const line of raw.split('\n')) {
    if (!line.includes('"wrb.fr"')) continue

    let arr: unknown
    try {
      arr = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(arr) || !arr.length) continue

    const frame = arr[0] as unknown
    if (!Array.isArray(frame) || frame.length < 3) continue

    const innerStr = frame[2]
    if (typeof innerStr !== 'string') continue

    let inner: unknown
    try {
      inner = JSON.parse(innerStr)
    } catch {
      continue
    }
    if (!Array.isArray(inner)) continue

    const pair = inner[1]
    if (!Array.isArray(pair) || !pair.length) continue

    const cid = pair[0]
    const rid = pair[1]
    if (typeof cid === 'string' && cid) {
      // The pair may be length 1 (chat only) or 2 (chat + reply). Both are valid
      // continuations; the reference implementation accepts either.
      const meta = [cid]
      if (typeof rid === 'string' && rid) meta.push(rid)
      return meta
    }
  }
  return null
}

/**
 * The `x-goog-ext-525001261-jspb` header that selects a model.
 *
 * Shape read from the reference implementation's build_model_header: the id
 * sits at index 4, the capacity at 11, the tier number at 14, then a thinking
 * flag and the session id. Slot [79] of the payload must carry the SAME tier
 * number, or header and payload disagree and the request is rejected.
 */
export function buildModelHeader(
  model: GeminiWebModel,
  sessionId: string,
  extendedThinking = false
): string {
  return JSON.stringify([
    1,
    null,
    null,
    null,
    model.id,
    null,
    null,
    0,
    [4, 5, 6, 8],
    null,
    null,
    model.capacity,
    null,
    null,
    model.number,
    extendedThinking ? 2 : 1,
    sessionId
  ])
}

/**
 * The client's own session id for the model header.
 *
 * This is NOT the page's `f.sid` (`FdrFJe`). Passing the page value produces a
 * short status frame — `[["wrb.fr",null,null,null,null,[13]]]` — instead of an
 * answer, with no error surfaced: a silent failure that looks like an empty
 * reply. The reference implementation generates its own UUID for this field, so
 * this does too. Verified against the live endpoint: UUID answers, `FdrFJe`
 * does not.
 */
export function makeSessionId(): string {
  return randomUUID().toUpperCase()
}

/** A fresh request uuid. Uppercase; the server is case-sensitive about it. */
export function makeRequestUuid(): string {
  return randomUUID().toUpperCase()
}

// ── Response parsing ────────────────────────────────────────────────────────

/** Thrown for a response Google explicitly rejected, with its error code. */
export class GeminiWebError extends Error {
  readonly code: string
  constructor(message: string, code = 'unknown') {
    super(message)
    this.name = 'GeminiWebError'
    this.code = code
  }
}

/**
 * Pull the assistant's text out of the StreamGenerate response.
 *
 * The body is a length-prefixed stream of JSON arrays, one per line, most of
 * which are noise. Useful lines carry a `wrb.fr` frame whose element [2] is
 * itself a JSON STRING holding the payload.
 *
 * The reply arrives REPEATEDLY, each frame carrying more text than the last
 * (the model streams by resending the accumulated answer), so the LONGEST
 * string wins. Taking the last frame blindly can catch a shorter later one and
 * truncate the reply.
 */
export function parseResponseText(raw: string): string {
  // A rejected request is reported in-band, not by HTTP status.
  const errMatch = raw.match(/BardErrorInfo\s*\[(\d+)\]/)
  if (errMatch) {
    throw new GeminiWebError(
      `Gemini rejected the request (BardErrorInfo ${errMatch[1]}). The session may have expired, or this model may not be available on the account.`,
      `bard_error_${errMatch[1]}`
    )
  }

  let best = ''

  for (const line of raw.split('\n')) {
    if (!line.includes('"wrb.fr"')) continue

    let arr: unknown
    try {
      arr = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(arr)) continue

    const frame = arr[0] as unknown
    if (!Array.isArray(frame)) continue

    const innerStr = frame[2] as unknown
    if (typeof innerStr !== 'string') continue

    let inner: unknown
    try {
      inner = JSON.parse(innerStr)
    } catch {
      continue
    }
    if (!Array.isArray(inner) || inner.length <= 4 || !inner[4]) continue

    for (const part of inner[4] as unknown[]) {
      if (!Array.isArray(part) || part.length <= 1) continue
      const texts = part[1]
      if (!Array.isArray(texts)) continue
      for (const t of texts) {
        if (typeof t === 'string' && t.length > best.length) best = t
      }
    }
  }

  return best
}

/**
 * Strip internal code-execution artifacts the web UI injects when the model
 * uses its interpreter. They are not part of the answer and would otherwise
 * land in the subtitle file.
 */
export function cleanResponseText(text: string): string {
  return text
    .replace(
      /```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g,
      ''
    )
    .trim()
}

/**
 * Explain a non-200 response.
 *
 * Error code 3 is gRPC INVALID_ARGUMENT — HTTP 400 — and on this endpoint it
 * means the request shape was rejected. The detail element is the useful part:
 * when it carries an xsrf object the token failed to validate, and when it is
 * EMPTY the request itself is malformed (a wrong payload length, a stray slot).
 * Both were hit while building this, so the message distinguishes them instead
 * of reporting a bare status.
 */
export function describeHttpFailure(status: number, body: string): string {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (status === 400) {
    if (/xsrf/i.test(body)) {
      return 'Gemini rejected the session token (xsrf). Sign in again from Advanced → Gemini web.'
    }
    return `Gemini rejected the request shape (HTTP 400). ${detail}`
  }
  if (status === 401 || status === 403) {
    return 'Gemini refused the request — the session has expired. Sign in again from Advanced → Gemini web.'
  }
  if (status === 405) {
    return 'Gemini rejected a stale build id (HTTP 405). Retrying with a fresh one.'
  }
  return `Gemini returned HTTP ${status}. ${detail}`
}
