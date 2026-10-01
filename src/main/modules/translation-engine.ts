import type { SubtitleEntry, ApiSettings, TranslationProgress } from '@shared/types'
import { CHUNK_SIZE, CONCURRENCY, MAX_CONCURRENCY } from '@shared/constants'
import { buildMessages } from './prompt-builder'
import { sendAntigravityWithFallback, AntigravityApiError, AntigravityModelError } from './antigravity/transport'
import type { AntigravityMessage } from './antigravity/transport'
import { parseSrt, cleanAiResponse } from './srt-parser'
import { log } from './logger'
import {
  fingerprintJob,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint
} from './translation-checkpoint'

/**
 * Cancellation signal.
 *
 * `new Error('AbortError')` sets `message`, NOT `name` — so every
 * `err.name === 'AbortError'` check downstream silently failed and a cancel was
 * reported as a failure. This class sets `name` correctly so the abort is
 * detectable by name, which is the convention the rest of the code expects.
 */
export class TranslationAbortError extends Error {
  constructor() {
    super('Translation cancelled')
    this.name = 'AbortError'
  }
}

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
  /** Source filename, recorded with the checkpoint so the UI can name it. */
  sourceName?: string
}

/** Reported back to the caller when a job resumes from a checkpoint. */
export interface ResumeInfo {
  resumedChunks: number
  totalChunks: number
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
 * Resumability:
 * - Completed chunks are written to a checkpoint keyed by a fingerprint of the
 *   input cues plus the model id, so a crash, a closed window or a cancel does
 *   not throw away work already paid for in quota. A resumed run skips the
 *   chunks it already has and reports how many it recovered.
 *
 * Adaptive concurrency:
 * - Starts at CONCURRENCY (6) in-flight requests — the known-safe floor.
 * - Any 429 shrinks the in-flight limit (×0.6, min 1).
 * - A steady clean streak (>8s without a 429) recovers +1, up to
 *   MAX_CONCURRENCY (12).
 *
 * Measured against the live backend: one request takes ~14s and is almost all
 * waiting, so this work is LATENCY-bound. Six in flight finished in ~18s and
 * twelve in ~24s, i.e. the upstream is not saturated at 6 — so the ramp is the
 * main speed lever, and a 429 pulls it straight back down.
 */
export async function translateAll(params: TranslateAllParams): Promise<SubtitleEntry[]> {
  const { entries, settings, onProgress, signal, sourceName } = params
  const chunks = chunkArray(entries, CHUNK_SIZE)
  const totalChunks = chunks.length
  if (totalChunks === 0) return []

  const settled: (SubtitleEntry[] | null)[] = new Array(totalChunks).fill(null)
  // Chunks that used up every retry. Non-empty at the end => the job FAILED and
  // must be reported as such (never as a successful run that produced English).
  const failedChunks = new Set<number>()
  // Chunks that genuinely hold TRANSLATED text. `settled` cannot be used for
  // this: failures and aborts settle their slot with the ORIGINAL cues so the
  // preview stays full-length, and checkpointing one of those would mark an
  // untranslated chunk as done — a later resume would then skip it and export
  // English. Only indices in this set are ever persisted.
  const translatedOk = new Set<number>()

  // Resume: seed slots from a checkpoint so chunks already paid for are skipped.
  // Keyed by cues + model, so a different file or model never inherits this work.
  const fingerprint = fingerprintJob(entries, settings.modelId)
  const prior = loadCheckpoint(fingerprint)
  let resumedChunks = 0
  if (prior && prior.totalChunks === totalChunks) {
    for (let i = 0; i < totalChunks; i++) {
      const saved = prior.chunks[String(i)]
      // Only accept a chunk whose cue count matches, so a changed input cannot
      // be spliced in with stale text.
      if (saved && saved.length === chunks[i].length) {
        settled[i] = saved
        translatedOk.add(i)
        resumedChunks++
      }
    }
  }
  if (resumedChunks > 0) {
    log.info(`resuming: ${resumedChunks}/${totalChunks} chunks restored from checkpoint`)
  }

  const checkpointState = (): void => {
    const chunksOut: Record<string, SubtitleEntry[]> = {}
    for (let i = 0; i < totalChunks; i++) {
      // NEVER checkpoint a failed chunk. runChunk settles failures with the
      // ORIGINAL text so the preview stays full-length — persisting that would
      // mark an untranslated chunk as done, and a later resume would skip it and
      // export English. Only genuinely translated chunks may be stored.
      if (failedChunks.has(i)) continue
      if (!translatedOk.has(i)) continue
      const s = settled[i]
      if (s) chunksOut[String(i)] = s
    }
    saveCheckpoint({
      fingerprint,
      chunks: chunksOut,
      totalChunks,
      modelId: settings.modelId,
      sourceName,
      savedAt: Date.now()
    })
  }

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

  /**
   * How many CUES are actually translated so far.
   *
   * `snapshot()` pads untranslated chunks with their original text so the table
   * always has full-length data — which means its length can never be used as a
   * progress figure (it reads as 100% on the first event). This counts only
   * settled chunks, so the number is honest.
   */
  const totalCues = entries.length
  const translatedCueCount = (): number => {
    let done = 0
    for (let i = 0; i < totalChunks; i++) {
      const s = settled[i]
      if (s) done += s.length
    }
    return done
  }

  const emit = (p: Omit<TranslationProgress, 'jobId'>): void => {
    onProgress({
      jobId: '',
      ...p,
      activeChunks: inflight,
      translatedCues: translatedCueCount(),
      totalCues,
      resumedChunks
    })
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

      // A response with FEWER lines than we asked for means the model dropped
      // some cues. The old behaviour kept the original text for the missing
      // ones, which silently produced a part-English file that still reported
      // success — the one failure mode this app must never hide. Throw so the
      // chunk retries, and ultimately reports incomplete if it keeps failing.
      if (parsed.length < originals.length) {
        throw new Error(
          `Model returned ${parsed.length} of ${originals.length} cues — response was truncated or malformed.`
        )
      }

      return originals.map((orig, j) => ({
        id: orig.id,
        startTime: orig.startTime,
        endTime: orig.endTime,
        text: parsed[j].text
      }))
    }

    let saw429 = false
    let lastError: Error | null = null
    const maxAttempts = 6

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) throw new TranslationAbortError()

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
    translatedOk.add(i)
    // Persist the moment this chunk lands, so a crash or a close immediately
    // afterwards still keeps the work (and the quota it cost).
    checkpointState()

    // Emit AFTER writing the slot so the snapshot already includes it.
    emit({
      chunkIndex: i,
      totalChunks,
      status: 'received',
      partialResult: snapshot()
    })

    // Steady clean streak → recover one slot at a time, up to the ceiling.
    if (!saw429 && Date.now() - last429At > 8000 && limit < MAX_CONCURRENCY) {
      limit++
    }
  }

  while (nextChunk < totalChunks && !signal.aborted && !fatalError) {
    while (inflight >= limit && !signal.aborted && !fatalError) {
      await delay(40)
    }
    if (signal.aborted || fatalError) break

    const i = nextChunk++
    // A chunk restored from the checkpoint is already done — its work was paid
    // for in a previous run, so do not spend quota on it again.
    if (settled[i]) continue

    inflight++
    emit({ chunkIndex: i, totalChunks, status: 'sending' })
    runChunk(i).finally(() => { inflight-- })
  }

  while (inflight > 0 && !signal.aborted) {
    await delay(40)
  }
  if (signal.aborted) throw new TranslationAbortError()
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
  //
  // The checkpoint is deliberately NOT cleared: the chunks that did succeed are
  // worth keeping, so a retry resumes instead of paying for them again.
  if (failedChunks.size > 0) {
    throw new TranslationIncompleteError(
      [...failedChunks].sort((a, b) => a - b),
      totalChunks,
      results
    )
  }

  // Fully translated — the checkpoint has served its purpose.
  clearCheckpoint(fingerprint)
  return results
}