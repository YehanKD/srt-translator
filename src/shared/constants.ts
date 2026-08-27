export const CHUNK_SIZE = 15

export const CHUNK_DELAY_MS = 0

// Initial/max concurrent translation requests. The engine adapts this at
// runtime: it starts this hot and shrinks on 429 rate-limit responses, then
// gradually recovers as long as requests stay clean.
export const CONCURRENCY = 6

export const TRANSLATION_PROMPT = `Translate the following subtitle into natural spoken Sri Lankan Sinhala. Preserve the meaning, tone, and emotion. Do not censor profanity. Preserve the original subtitle numbers exactly as shown. Return only the translated subtitle in the same SRT format.`

export const IPC_CHANNELS = {
  IMPORT_SRT: 'import-srt',
  IMPORT_SRT_PATH: 'import-srt-path',
  EXPORT_SRT: 'export-srt',
  FETCH_MODELS: 'fetch-models',
  SELECT_MKV: 'select-mkv',
  LIST_MKV_TRACKS: 'list-mkv-tracks',
  EXTRACT_MKV_TRACK: 'extract-mkv-track',
  START_TRANSLATION: 'start-translation',
  CANCEL_TRANSLATION: 'cancel-translation',
  TRANSLATION_PROGRESS: 'translation-progress',
  TRANSLATION_COMPLETE: 'translation-complete'
} as const
