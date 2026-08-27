import type { SubtitleEntry, ApiSettings, TranslationProgress } from '@shared/types'
import { CHUNK_SIZE, CONCURRENCY } from '@shared/constants'
import { buildMessages } from './prompt-builder'
import { sendChatCompletion, ApiError } from './api-client'
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

interface TranslateAllParams {
  entries: SubtitleEntry[]
  settings: ApiSettings
  onProgress: (progress: TranslationProgress) => void
  signal: AbortSignal
}

/**
 * Parallel chunk translation with fool-proof ordering AND adaptive concurrency.
 *
 * Ordering safety (why this cannot scramble subtitles):
 * 1. Each chunk owns ONE pre-allocated slot in `settled[]`; only its own worker
 *    writes that slot — never a shared growing array.
 * 2. The UI's `partialResult` is ALWAYS a snapshot walking chunk indices 0..N in
 *    order (`settled[i] ?? chunks[i]`), so the preview stays aligned at all
 *    times: rows flip to Sinhala only as their own chunk completes.
 * 3. The final result is flattened from `settled[]` in index order after all
 *    chunks settle.
 * 4. A shared `nextChunk` counter hands every chunk to the pool exactly once.
 * 5. Per-chunk index-based matching (keep original ids/timestamps, take only
 *    translated text). Persistent failure falls back to originals.
 *
 * Adaptive concurrency (why more is safe to ask for):
 * - Starts hot at CONCURRENCY (6) in-flight requests.
 * - Any 429 shrinks the in-flight limit (×0.6, min 1) — the pool self-throttles
 *   to whatever the provider comfortably allows instead of stacking backoffs.
 * - A steady clean streak (>8s without a 429) recovers +1 up to CONCURRENCY.
 */
export async function translateAll(params: TranslateAllParams): Promise<SubtitleEntry[]> {
  const { entries, settings, onProgress, signal } = params
  const chunks = chunkArray(entries, CHUNK_SIZE)
  const totalChunks = chunks.length
  if (totalChunks === 0) return []

  // settled[i] = translated entries for chunk i (set exactly once, by its
  // worker). null = still pending or not yet started.
  const settled: (SubtitleEntry[] | null)[] = new Array(totalChunks).fill(null)

  let nextChunk = 0
  let inflight = 0
  let limit = Math.min(CONCURRENCY, totalChunks)
  let last429At = 0

  // Coherent in-order preview. Never a growing list of completed chunks —
  // always the full document, per-chunk substituted in index order.
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

    // Index-based matching: keep original ids/timestamps, take only text.
    const buildResult = (parsed: SubtitleEntry[]): SubtitleEntry[] =>
      originals.map((orig, j) =>
        j < parsed.length
          ? { id: orig.id, startTime: orig.startTime, endTime: orig.endTime, text: parsed[j].text }
          : orig
      )

    let saw429 = false
    let lastError: Error | null = null
    const maxAttempts = 6

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) throw new Error('AbortError')

      try {
        const response = await sendChatCompletion({
          endpointUrl: settings.endpointUrl,
          apiKey: settings.apiKey,
          modelId: settings.modelId,
          messages,
          signal
        })

        const cleaned = cleanAiResponse(response)
        const parsed = parseSrt(cleaned)

        lastError = null
        return { translated: parsed.length > 0 ? buildResult(parsed) : originals, saw429 }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        lastError = err instanceof Error ? err : new Error(String(err))

        // Rate limit → shrink the pool; the whole point of adaptive concurrency.
        if (lastError instanceof ApiError && lastError.status === 429) {
          saw429 = true
          limit = Math.max(1, Math.floor(limit * 0.6))
          last429At = Date.now()
        }

        if (attempt < maxAttempts - 1) {
          if (lastError instanceof ApiError && lastError.status === 429) {
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

    emit({
      chunkIndex: i,
      totalChunks,
      status: 'error',
      errorMessage: lastError?.message
    })
    return { translated: originals, saw429 } // fallback: never lose or scramble content
  }

  const runChunk = async (i: number): Promise<void> => {
    const { translated, saw429 } = await translateChunk(i)
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

  // Dispatcher: keep up to `limit` requests in flight, pulling chunk indices
  // from the shared counter. Self-throttles when `limit` shrinks.
  while (nextChunk < totalChunks && !signal.aborted) {
    while (inflight >= limit && !signal.aborted) {
      await delay(40)
    }
    if (signal.aborted) break

    const i = nextChunk++
    inflight++
    emit({ chunkIndex: i, totalChunks, status: 'sending' })
    runChunk(i).finally(() => { inflight-- })
  }

  // Drain in-flight requests.
  while (inflight > 0 && !signal.aborted) {
    await delay(40)
  }
  if (signal.aborted) throw new Error('AbortError')

  // Flatten in index order — guaranteed aligned by construction.
  const results: SubtitleEntry[] = []
  for (let i = 0; i < totalChunks; i++) {
    results.push(...(settled[i] ?? chunks[i]))
  }
  return results
}
