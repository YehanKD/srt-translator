import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SubtitleEntry } from '@shared/types'

/**
 * Checkpoints for interrupted translations.
 *
 * WHY: a job's progress lived only in memory, so a crash, a closed window, or a
 * cancel at chunk 99 of 100 threw away every translated chunk. On a feature film
 * that is minutes of work and a wasted quota spend, because the whole file had
 * to be re-translated from the start.
 *
 * HOW IT IS KEYED: a fingerprint over the input cues plus the model id. Re-running
 * the same file with the same model therefore finds its own checkpoint, while a
 * different file (or a different model) never picks up someone else's partial
 * work. Nothing is resumed silently — the caller reports it.
 *
 * WHAT IS STORED: only the translated cues for chunks that finished. No tokens,
 * no account data.
 */

export interface TranslationCheckpoint {
  fingerprint: string
  /** Translated cues, keyed by chunk index. */
  chunks: Record<string, SubtitleEntry[]>
  totalChunks: number
  modelId: string
  /** Source filename, for telling the user which file this belongs to. */
  sourceName?: string
  savedAt: number
}

/** Checkpoints older than this are ignored and cleaned up. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Keep at most this many, oldest pruned first. */
const MAX_FILES = 20

function checkpointDir(): string | null {
  try {
    const dir = join(app.getPath('userData'), 'checkpoints')
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return null
  }
}

/**
 * Stable identity for a translation job.
 *
 * Includes the model id because a checkpoint translated by one model should not
 * be resumed as though a different model produced it. Timings and ids are
 * included so a re-cut subtitle file does not collide with an older one.
 */
export function fingerprintJob(entries: SubtitleEntry[], modelId: string): string {
  const h = createHash('sha256')
  h.update(modelId)
  h.update('\u0000')
  h.update(String(entries.length))
  for (const e of entries) {
    h.update('\u0001')
    h.update(`${e.id}|${e.startTime}|${e.endTime}|${e.text}`)
  }
  return h.digest('hex').slice(0, 32)
}

function pathFor(fingerprint: string): string | null {
  const dir = checkpointDir()
  return dir ? join(dir, `${fingerprint}.json`) : null
}

/** Remove checkpoints past the age limit, and the oldest beyond MAX_FILES. */
function prune(): void {
  const dir = checkpointDir()
  if (!dir) return
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    const now = Date.now()
    const kept: { file: string; mtime: number }[] = []

    for (const file of files) {
      const full = join(dir, file)
      try {
        const { mtimeMs } = statSync(full)
        if (now - mtimeMs > MAX_AGE_MS) {
          rmSync(full, { force: true })
          continue
        }
        kept.push({ file, mtime: mtimeMs })
      } catch {
        // Unreadable entry — leave it; it is harmless.
      }
    }

    if (kept.length > MAX_FILES) {
      kept.sort((a, b) => a.mtime - b.mtime)
      for (const { file } of kept.slice(0, kept.length - MAX_FILES)) {
        rmSync(join(dir, file), { force: true })
      }
    }
  } catch {
    // Pruning is housekeeping; never let it break a translation.
  }
}

export function loadCheckpoint(fingerprint: string): TranslationCheckpoint | null {
  const path = pathFor(fingerprint)
  if (!path) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as TranslationCheckpoint
    if (data.fingerprint !== fingerprint) return null
    if (typeof data.savedAt !== 'number' || Date.now() - data.savedAt > MAX_AGE_MS) return null
    if (!data.chunks || typeof data.totalChunks !== 'number') return null
    return data
  } catch {
    // Missing or corrupt — treat as no checkpoint.
    return null
  }
}

export function saveCheckpoint(cp: TranslationCheckpoint): void {
  const path = pathFor(cp.fingerprint)
  if (!path) return
  try {
    writeFileSync(path, JSON.stringify({ ...cp, savedAt: Date.now() }))
  } catch {
    // A failed checkpoint write must never fail the translation itself.
  }
}

export function clearCheckpoint(fingerprint: string): void {
  const path = pathFor(fingerprint)
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch {
    // Best-effort.
  }
}

export function pruneCheckpoints(): void {
  prune()
}
