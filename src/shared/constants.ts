export const CHUNK_SIZE = 15

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
  // Diagnostics — open the log file / its folder for bug reports.
  OPEN_LOG: 'open-log',
  // Files
  IMPORT_SRT: 'import-srt',
  IMPORT_SRT_PATH: 'import-srt-path',
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
