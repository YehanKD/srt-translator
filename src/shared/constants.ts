export const CHUNK_SIZE = 15

/**
 * Cues per request when translating through Gemini web.
 *
 * A Gemini web conversation is not billed per cue — it is limited by how many
 * MESSAGES the account sends. At CHUNK_SIZE (15) a 1500-cue movie is 100
 * requests, and 100 messages is what trips the rate limiter. Sending the whole
 * span in one message makes that same movie 3 requests.
 *
 * Verified against the live endpoint before adopting: 100, 300 and 500 cues
 * each returned EVERY input cue number, first to last, with no truncation —
 * 500 cues produced a 28,282-character reply in 71s.
 *
 * A translation job appends every request to ONE chat (see resetChatSession),
 * so a long file is a handful of messages in a single conversation rather than
 * one conversation per chunk.
 */
export const GEMINI_WEB_CHUNK_SIZE = 500

/**
 * Hard ceiling for a single Gemini-web request.
 *
 * 500 is the verified figure used for normal chunking; 600 was confirmed
 * working by hand, so a trailing fragment may be merged upward to here to save
 * a whole message. Beyond this the reply length grows past what has been
 * proven, so a fragment larger than the gap is left as its own request.
 */
export const GEMINI_WEB_CHUNK_CEILING = 600

export const CHUNK_DELAY_MS = 0

/**
 * Concurrency for translation requests.
 *
 * Measured against the live Antigravity backend (Gemini 3.1 Pro, 15-cue chunks):
 *   - one request takes ~14s, almost all of it waiting, so the work is
 *     LATENCY-bound rather than throughput-bound.
 *   - 6 requests in flight finished in ~18s (1.25x one request), so they really
 *     do run in parallel.
 *   - 12 in flight finished in ~24s — still well under two sequential
 *     latencies, so the upstream is not saturated at 6.
 *
 * That makes concurrency the right lever: wall time is roughly
 * ceil(chunks / limit) x latency.
 *
 * START vs MAX: begin at the known-safe 6 and ramp up. Ramping avoids opening
 * with a burst the backend may throttle, while still letting a long file reach
 * the higher ceiling once requests prove clean. Any 429 shrinks the limit
 * immediately (see translation-engine), so this cannot run away.
 */
export const CONCURRENCY = 6

/** Upper bound the adaptive ramp may reach while requests stay clean. */
export const MAX_CONCURRENCY = 12

export const TRANSLATION_PROMPT = `Translate the following subtitle into natural spoken Sri Lankan Sinhala. Preserve the meaning, tone, and emotion. Do not censor profanity. Preserve the original subtitle numbers exactly as shown. Return only the translated subtitle in the same SRT format.`

export const IPC_CHANNELS = {
  // Antigravity account auth
  AUTH_BEGIN: 'auth-begin',
  AUTH_CANCEL: 'auth-cancel',
  AUTH_STATUS: 'auth-status',
  AUTH_LOGOUT: 'auth-logout',
  AUTH_CAN_PERSIST: 'auth-can-persist',
  AUTH_PROGRESS: 'auth-progress',
  AUTH_STATE_CHANGED: 'auth-state-changed',
  // Account data
  QUOTA_GET: 'quota-get',
  QUOTA_REFRESH: 'quota-refresh',
  LIST_MODELS: 'list-models',
  // Gemini web — the second provider. Reaches models Antigravity no longer
  // offers; kept separate so its account state never mixes with the other.
  GWEB_STATUS: 'gweb-status',
  GWEB_CONNECT: 'gweb-connect',
  GWEB_DISCONNECT: 'gweb-disconnect',
  GWEB_PROBE: 'gweb-probe',
  // Diagnostics — open the log file / its folder for bug reports.
  OPEN_LOG: 'open-log',
  /** The running app's version, so a bug report can name the build. */
  APP_VERSION: 'app-version',
  // Files
  IMPORT_SRT: 'import-srt',
  IMPORT_SRT_PATH: 'import-srt-path',
  /** Write the translation beside its source with no dialog. */
  AUTO_SAVE_SRT: 'auto-save-srt',
  EXPORT_SRT: 'export-srt',
  SELECT_MKV: 'select-mkv',
  LIST_MKV_TRACKS: 'list-mkv-tracks',
  EXTRACT_MKV_TRACK: 'extract-mkv-track',
  // Translation
  START_TRANSLATION: 'start-translation',
  CANCEL_TRANSLATION: 'cancel-translation',
  TRANSLATION_PROGRESS: 'translation-progress',
  TRANSLATION_COMPLETE: 'translation-complete'
} as const
