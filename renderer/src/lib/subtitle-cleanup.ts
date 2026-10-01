import type { SubtitleEntry } from '@shared/types'
import { stripSoundCues } from './sound-cues'

/**
 * Automatic subtitle cleanup, run once when a file is imported.
 *
 * Three passes, applied in this order:
 *   1. Sound cues    — drop lines that are only a sound description, and strip
 *                      sound tags that sit beside real dialogue.
 *   2. Music lines   — drop song lyrics, which SDH wraps in a musical note.
 *   3. Speaker names — drop a leading "NAME:" label.
 *
 * WHY AUTOMATIC: these were three toolbar buttons the user had to remember to
 * press. Forgetting meant sound descriptions and lyrics were sent to the
 * translator, which burns quota on text nobody reads and can come back as
 * nonsense. Cleaning at import means the preview shows exactly what will be
 * translated, and the counts are reported rather than silently applied.
 *
 * Every pass is conservative: when a rule is ambiguous it keeps the line.
 * Deleting real dialogue is far worse than leaving one sound tag in.
 */

// ─────────────────────────────── Music lines ───────────────────────────────

/** Musical note characters used to bracket song lyrics in SDH tracks. */
const NOTE_START_RE = /^[\u266A\u266B]/
const NOTE_END_RE = /[\u266A\u266B]$/

/** Markup and a leading speaker dash are not part of the lyric. */
function normalizeForCheck(line: string): string {
  return line
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/^\s*[-\u2013\u2014]\s*/, '')
    .trim()
}

function startsWithNote(line: string): boolean {
  return NOTE_START_RE.test(normalizeForCheck(line))
}

function endsWithNote(line: string): boolean {
  return NOTE_END_RE.test(normalizeForCheck(line))
}

/**
 * Remove song lyrics from one cue's lines.
 *
 * The confirmed pattern is a note at BOTH ends of the lyric — `♪ text ♪`. When a
 * lyric wraps across two lines the opening note is on the first and the closing
 * note on the second, so a line that opens a note without closing it pulls in
 * every following line up to the one that closes it.
 */
function stripMusicFromLines(lines: string[]): { lines: string[]; removed: number } {
  const kept: string[] = []
  let removed = 0

  for (let i = 0; i < lines.length; i++) {
    if (!startsWithNote(lines[i])) {
      kept.push(lines[i])
      continue
    }

    if (endsWithNote(lines[i])) {
      removed++
      continue
    }

    // Opened a note without closing it — find the line that closes it.
    let j = i + 1
    while (j < lines.length && !endsWithNote(lines[j])) j++

    if (j < lines.length) {
      removed += j - i + 1
      i = j
    } else {
      // Never closes: an unpaired lyric fragment, still not dialogue.
      removed++
    }
  }

  return { lines: kept, removed }
}

// ────────────────────────────── Speaker names ──────────────────────────────

/**
 * Titles that mark the following word as a person's name, e.g. "DR. SMITH".
 * A label like this is a name even when every word is capitalised.
 */
const TITLE_ABBREV_RE = /^(?:DR|MR|MRS|MS|MISS|PROF|SGT|DET|CAPT|LT|COL|MAJ|GEN|OFC|OFF|CMMR|REV|FR|SR|JR)\.$/i

/**
 * A leading speaker label: "JASON:", "Joel:", "DR. SMITH:".
 *
 * The previous rule stripped any run of capitals before a colon, which damaged
 * dialogue: "I SAID: stop right now!" became "stop right now!", and cues like
 * "WAIT:" or "NO ONE KNOWS:" were emptied completely. It also ate episode
 * markers ("S02E01: The Beginning"). Those cases were real; the labels it was
 * meant to catch were not present at all in 2,641 cues across four files.
 *
 * The tightened rule keeps the classic form and refuses the harmful ones:
 *   - at most two words, so a sentence-like label is never touched
 *   - never all-caps when it is more than one word, unless the first word is a
 *     title abbreviation ("DR. SMITH" is a name; "I SAID" is not)
 *   - no digits, which excludes "S02E01" and timecodes
 *   - only name punctuation: letters, space, period, apostrophe, hyphen
 */
const SPEAKER_LABEL_RE = /^\s*(?:[-\u2013\u2014]\s*)?([A-Za-z][A-Za-z.'\- ]{0,40}?):\s*/

function speakerLabelOf(line: string): string | null {
  const m = line.match(SPEAKER_LABEL_RE)
  if (!m) return null
  const label = m[1].trim()
  if (!label) return null

  // Digits mean an episode code or a timecode, not a name.
  if (/\d/.test(label)) return null

  const words = label.split(/\s+/)
  if (words.length > 2) return null

  // An all-caps phrase is more likely shouted dialogue than a name — unless the
  // first word is a title abbreviation, which only ever precedes a name.
  const isAllCaps = label === label.toUpperCase()
  if (isAllCaps && words.length > 1 && !TITLE_ABBREV_RE.test(words[0])) return null

  return label
}

/** Drop a speaker label, but never to the point of emptying the line. */
function stripSpeakerFromLine(line: string): string | null {
  const label = speakerLabelOf(line)
  if (!label) return null
  const rest = line.replace(SPEAKER_LABEL_RE, '').trim()
  // Nothing left would delete the line's entire content — keep it as-is.
  if (!rest) return null
  return rest
}

// ────────────────────────────── Orchestration ──────────────────────────────

export interface CleanupStats {
  /** Cues dropped because nothing translatable remained. */
  removedCues: number
  /** Cues kept but edited. */
  cleanedCues: number
  /** Sound descriptions removed. */
  soundTags: number
  /** Song lyric lines removed. */
  musicLines: number
  /** Speaker labels removed. */
  speakerLabels: number
  /** Cues in, and out. */
  totalIn: number
  totalOut: number
}

/**
 * Run every cleanup pass over freshly imported cues.
 *
 * Pure: returns new entries and never mutates the input. Ids are renumbered so
 * the exported SRT stays sequential.
 */
export function cleanupSubtitles(entries: SubtitleEntry[]): {
  entries: SubtitleEntry[]
  stats: CleanupStats
} {
  // Pass 1 — sound cues (drops pure-sound lines, strips tags beside dialogue).
  const sound = stripSoundCues(entries)

  // Pass 2 — music lines.
  let musicLines = 0
  const afterMusic: SubtitleEntry[] = []
  for (const e of sound.entries) {
    const r = stripMusicFromLines(e.text.split('\n'))
    if (r.removed > 0) musicLines += r.removed
    if (r.lines.length === 0) continue
    afterMusic.push({ ...e, text: r.lines.join('\n') })
  }

  // Pass 3 — speaker labels.
  let speakerLabels = 0
  const afterSpeaker: SubtitleEntry[] = []
  for (const e of afterMusic) {
    let touched = false
    const lines = e.text
      .split('\n')
      .map((line) => {
        const stripped = stripSpeakerFromLine(line)
        if (stripped === null) return line
        speakerLabels++
        touched = true
        return stripped
      })
      .filter((l) => l.trim().length > 0)

    if (lines.length === 0) continue
    afterSpeaker.push(touched ? { ...e, text: lines.join('\n') } : e)
  }

  // "Cleaned" means the cue survived but its text is not what was imported.
  // Tracked by identity as each cue passes through, so a cue that lost lines in
  // two different passes is still counted once.
  const survivors = new Map(afterSpeaker.map((e) => [e.startTime + '|' + e.endTime, e.text]))
  let cleanedCues = 0
  for (const e of entries) {
    const now = survivors.get(e.startTime + '|' + e.endTime)
    if (now !== undefined && now !== e.text) cleanedCues++
  }

  return {
    entries: afterSpeaker.map((e, i) => ({ ...e, id: String(i + 1) })),
    stats: {
      removedCues: entries.length - afterSpeaker.length,
      cleanedCues,
      soundTags: sound.removedTags,
      musicLines,
      speakerLabels,
      totalIn: entries.length,
      totalOut: afterSpeaker.length
    }
  }
}
