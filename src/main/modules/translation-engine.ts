import type { SubtitleEntry, ApiSettings, TranslationProgress } from '@shared/types'
import { CHUNK_SIZE, CONCURRENCY } from '@shared/constants'
import { buildMessages } from './prompt-builder'
import { sendAntigravityWithFallback, AntigravityApiError, AntigravityModelError } from './antigravity/transport'
import type { AntigravityMessage } from './antigravity/transport'
import { parseSrt, cleanAiResponse } from './srt-parser'

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * A chunk that used up every retry attempt. Carries its index so the caller can
 * report exactly which lines were left untranslated.
 */
export class ChunkExhaustedError extends Error {
  chunkIndex: number
  constructor(chunkIndex: number, cause: Error | null) {
    super(cause?.message || `Chunk ${chunkIndex} failed after all retries`)
    this.name = 'ChunkExhaustedError'
    this.chunkIndex = chunkIndex
  }
}

/**
 * Thrown when one or more chunks could not be translated. `partial` holds the
 * full, correctly-ordered subtitle list (failed chunks still carry their
 * original text) so the UI can show what did succeed and warn about the rest.
 */
export class TranslationIncompleteError extends Error {
  failedChunks: number[]
  totalChunks: number
  partial: SubtitleEntry[]
  constructor(failedChunks: number[], totalChunks: number, partial: SubtitleEntry[]) {
    const n = failedChunks.length
    super(
      `${n} of ${totalChunks} chunk${totalChunks === 1 ? '' : 's'} failed after all retries — ` +
        `those lines are still in the original language. Nothing was silently skipped.`
    )
    this.name = 'TranslationIncompleteError'
    this.failedChunks = failedChunks
    this.totalChunks = totalChunks
    this.partial = partial
  }
}

interface TranslateAllParams {
  entries: SubtitleEntry[]
  settings: ApiSettings
  onProgress: (progress: TranslationProgress) => void
  signal: AbortSignal
}

/**
 * Parallel chunk translation with fool-proof ordering AND adaptive concurrency.
 *
 * Ordering safety:
 * 1. Each chunk owns ONE pre-allocated slot in `settled[]`; only its own worker writes that slot.
 * 2. The UI's `partialResult` is ALWAYS a snapshot walking chunk indices 0..N in order.
 * 3. The final result is flattened from `settled[]` in index order after all chunks settle.
 * 4. A shared `nextChunk` counter hands every chunk to the pool exactly once.
 * 5. Per-chunk index-based matching (keep original ids/timestamps, take only translated text).
 *
 * Adaptive concurrency:
 * - Starts hot at CONCURRENCY (6) in-flight requests.
 * - Any 429 shrinks the in-flight limit (×0.6, min 1).
 * - A steady clean streak (>8s without a 429) recovers +1 up to CONCURRENCY.
 */
export async function translateAll(params: TranslateAllParams): Promise<SubtitleEntry[]> {
  const { entries, settings, onProgress, signal } = params
  const chunks = chunkArray(entries, CHUNK_SIZE)
  const totalChunks = chunks.length
  if (totalChunks === 0) return []

  const settled: (SubtitleEntry[] | null)[] = new Array(totalChunks).fill(null)
  // Chunks that used up every retry. Non-empty at the end => the job FAILED and
  // must be reported as such (never as a successful run that produced English).
  const failedChunks = new Set<number>()

  let nextChunk = 0
  let inflight = 0
  let limit = Math.min(CONCURRENCY, totalChunks)
  let last429At = 0
  // First deterministic (non-retryable) failure aborts the whole job with a
  // clear message instead of silently completing with English subtitles.
  let fatalError: Error | null = null

  const snapshot = (): SubtitleEntry[] => {
    const out: SubtitleEntry[] = []
    for (let i = 0; i < totalChunks; i++) {
      out.push(...(settled[i] ?? chunks[i]))
    }
    return out
  }

  const emit = (p: Omit<TranslationProgress, 'jobId'>): void => {
    onProgress({ jobId: '', ...p, activeChunks: inflight })
  }

  const translateChunk = async (i: number): Promise<{ translated: SubtitleEntry[]; saw429: boolean }> => {
    const originals = chunks[i]
    const messages = buildMessages({ index: i, subtitles: originals, totalChunks })

    // Extract system and user messages
    const systemMsg = messages.find(m => m.role === 'system')
    const userMsg = messages.find(m => m.role === 'user')

    // Build Antigravity format
    const antigravityMessages: AntigravityMessage[] = []
    if (userMsg && userMsg.content) {
      antigravityMessages.push({ role: 'user', parts: [{ text: userMsg.content }] })
    }

    const systemInstruction = systemMsg ? systemMsg.content : undefined

    const buildResult = (text: string): SubtitleEntry[] => {
      const cleaned = cleanAiResponse(text)
      const parsed = parseSrt(cleaned)
      return originals.map((orig, j) =>
        j < parsed.length
          ? { id: orig.id, startTime: orig.startTime, endTime: orig.endTime, text: parsed[j].text }
          : orig
      )
    }

    let saw429 = false
    let lastError: Error | null = null
    const maxAttempts = 6

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) throw new Error('AbortError')

      try {
        const response = await sendAntigravityWithFallback({
          model: settings.modelId,
          messages: antigravityMessages,
          systemInstruction,
          maxOutputTokens: 8192,
          abortSignal: signal
        })

        const translated = buildResult(response.text)
        lastError = null
        return { translated: translated.length > 0 ? translated : originals, saw429 }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        lastError = err instanceof Error ? err : new Error(String(err))

        const is429 =
          lastError instanceof AntigravityApiError && lastError.status === 429
        // Deterministic errors (model unavailable, forbidden, not signed in)
        // will never succeed on retry — fail this chunk fast with a clear error.
        const isDeterministic =
          lastError instanceof AntigravityModelError ||
          (lastError instanceof AntigravityApiError &&
            lastError.status !== 429 &&
            lastError.status < 500)
        const isRateLimit =
          is429 ||
          lastError.message?.includes('429') ||
          lastError.message?.includes('rate')
        if (isRateLimit) {
          saw429 = true
          limit = Math.max(1, Math.floor(limit * 0.6))
          last429At = Date.now()
        }

        if (isDeterministic) {
          fatalError = lastError
          emit({
            chunkIndex: i,
            totalChunks,
            status: 'error',
            errorMessage: lastError.message
          })
          // Unwind this worker; the dispatcher drains and translateAll throws.
          throw lastError
        }

        if (attempt < maxAttempts - 1) {
          if (isRateLimit) {
            const waitMs = Math.min(10000 * Math.pow(1.5, attempt), 60000)
            emit({
              chunkIndex: i,
              totalChunks,
              status: 'sending',
              errorMessage: `Rate limited, waiting ${Math.round(waitMs / 1000)}s...`
            })
            await delay(waitMs)
          } else {
            await delay(1000 * Math.pow(2, attempt))
          }
        }
      }
    }

    // Every attempt failed. Record the chunk as failed (so the job reports an
    // error rather than a clean success) and settle it with the ORIGINAL text.
    failedChunks.add(i)
    emit({
      chunkIndex: i,
      totalChunks,
      status: 'error',
      errorMessage: lastError?.message
    })
    return { translated: originals, saw429 }
  }

  const runChunk = async (i: number): Promise<void> => {
    let translated: SubtitleEntry[]
    let saw429 = false
    try {
      const r = await translateChunk(i)
      translated = r.translated
      saw429 = r.saw429
    } catch (err) {
      if (fatalError && !(err instanceof Error && err.name === 'AbortError')) {
        // Deterministic failure — stop pulling new chunks so the remaining
        // queue doesn't keep firing doomed requests.
        fatalError = err as Error
      }
      // Always settle the slot with originals for the part we did not translate;
      // the job-level error still propagates from translateAll below.
      settled[i] = chunks[i]
      saw429 = false
      emit({
        chunkIndex: i,
        totalChunks,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        partialResult: snapshot()
      })
      return
    }

    settled[i] = translated

    // Emit AFTER writing the slot so the snapshot already includes it.
    emit({
      chunkIndex: i,
      totalChunks,
      status: 'received',
      partialResult: snapshot()
    })

    // Steady clean streak → recover one slot at a time.
    if (!saw429 && Date.now() - last429At > 8000 && limit < CONCURRENCY) {
      limit++
    }
  }

  while (nextChunk < totalChunks && !signal.aborted && !fatalError) {
    while (inflight >= limit && !signal.aborted && !fatalError) {
      await delay(40)
    }
    if (signal.aborted || fatalError) break

    const i = nextChunk++
    inflight++
    emit({ chunkIndex: i, totalChunks, status: 'sending' })
    runChunk(i).finally(() => { inflight-- })
  }

  while (inflight > 0 && !signal.aborted) {
    await delay(40)
  }
  if (signal.aborted) throw new Error('AbortError')
  // Deterministic failure (e.g. model not on this account) — surface it as a
  // job-level error so the UI shows why nothing was translated.
  if (fatalError) throw fatalError

  const results: SubtitleEntry[] = []
  for (let i = 0; i < totalChunks; i++) {
    results.push(...(settled[i] ?? chunks[i]))
  }

  // Some chunks exhausted their retries. Returning `results` here would look
  // like a successful translation that merely happened to emit English for part
  // of the file — the exact failure this app must never hide. Throw instead, and
  // carry the ordered partial result so the UI can still show what succeeded.
  if (failedChunks.size > 0) {
    throw new TranslationIncompleteError(
      [...failedChunks].sort((a, b) => a - b),
      totalChunks,
      results
    )
  }

  return results
}