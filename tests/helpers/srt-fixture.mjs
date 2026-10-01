/**
 * Read an SRT file into SubtitleEntry objects.
 *
 * Deliberately a separate, simple parser rather than the app's own: if the test
 * used the parser under test to build its input, a parser bug would corrupt the
 * fixture and the test would still pass. This one only needs to be good enough
 * to load real subtitle files.
 */
import { readFileSync } from 'node:fs'

export function parseSrtFile(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  const entries = []

  for (const block of raw.trim().split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/)
    if (lines.length < 3) continue
    if (!/^\d+$/.test(lines[0].trim())) continue
    const [startTime, endTime] = lines[1].split('-->').map((s) => s.trim())
    entries.push({
      id: lines[0].trim(),
      startTime,
      endTime: endTime ?? '',
      text: lines.slice(2).join('\n').trim()
    })
  }

  return entries
}

/** Build a single SubtitleEntry, numbered by insertion order. */
let counter = 0
export function cue(text) {
  counter += 1
  const n = String(counter).padStart(2, '0')
  return { id: String(counter), startTime: `00:00:${n},000`, endTime: `00:00:${n},500`, text }
}

/** Reset the cue counter so ids are predictable per test. */
export function resetCueCounter() {
  counter = 0
}
