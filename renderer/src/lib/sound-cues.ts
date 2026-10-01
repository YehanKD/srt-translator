import type { SubtitleEntry } from '@shared/types'

/**
 * Sound-cue removal for SDH (subtitles for the deaf and hard of hearing).
 *
 * WHY THIS EXISTS: the previous rule required a cue's ENTIRE text to be one
 * bracketed run (`^\s*(\(…\)|\[…\])\s*$`). Against a real English SDH track
 * (Dark Matter S02E01, 774 cues) it removed 153 and left 111 cues still
 * carrying sound descriptions, because SDH does not format them that
 * uniformly. The shapes it missed:
 *
 *   1. Every line bracketed, but with speaker dashes
 *        "- [indistinct police chatter]\n- [sirens wailing in distance]"
 *   2. A sound tag beside dialogue on the same line
 *        "[sighs] Thanks."   /   "Well... [sighs]"
 *   3. A dash-led sound line next to a dash-led dialogue line
 *        "- [chuckles]\n- Mmm, but how will I have my coffee?"
 *   4. A bracket spanning a line break, or a speaker label plus a tag
 *        "[dispatcher] <i>All officers…</i>"
 *
 * THE MODEL: work per line, not per cue.
 *   - Drop a line if, once its sound tags and markup are removed, nothing is
 *     left. That is a line that existed only to describe a sound.
 *   - Otherwise keep the line with its sound tags stripped, because a
 *     description like "[sighs]" should not be sent to the translator.
 *   - Drop the whole cue only when every line is dropped.
 *
 * Deliberately NOT handled: bare ALL-CAPS lines ("MUSIC PLAYING") and
 * musical-note lines. ALL-CAPS is ambiguous — it is also how shouting is
 * marked in ordinary dialogue — so guessing there would delete real speech.
 * Brackets and parentheses are the unambiguous convention, and covering them
 * fixes every miss found in the sample track.
 */

/** A bracketed sound description: [ … ] or ( … ), non-nested. */
const SOUND_TAG_RE = /[\[(][^\])]*[\])]/g

/** Leading speaker dash on a cue line: "- ", "– ", "— ". */
const SPEAKER_DASH_RE = /^\s*[-–—]\s*/

/** Formatting markup that carries no words: <i>, </i>, <font …>. */
const MARKUP_RE = /<\/?[a-zA-Z][^>]*>/g

/** True when a line has no words once tags and markup are removed. */
function isPureSoundLine(line: string): boolean {
  const withoutTags = line
    .replace(SPEAKER_DASH_RE, '')
    .replace(SOUND_TAG_RE, '')
    .replace(MARKUP_RE, '')
    .replace(/[\s\u200b\u200e\u200f]/g, '')
  return withoutTags.length === 0
}

/** Remove sound tags from a line and tidy the spacing left behind. */
function stripTagsFromLine(line: string): string {
  return line
    .replace(SOUND_TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/g, '')
    .replace(/^[ \t]+/g, '')
}

export interface SoundCueResult {
  entries: SubtitleEntry[]
  /** Cues dropped completely — they were nothing but sound descriptions. */
  removedCues: number
  /** Cues kept, but with a sound tag removed from them. */
  cleanedCues: number
  /** Total sound tags removed across every cue. */
  removedTags: number
}

/**
 * Remove sound descriptions from SDH cues.
 *
 * Pure function: returns new entries and never mutates the input. Ids are
 * renumbered so the exported SRT stays sequential.
 */
export function stripSoundCues(entries: SubtitleEntry[]): SoundCueResult {
  const out: SubtitleEntry[] = []
  let removedCues = 0
  let cleanedCues = 0
  let removedTags = 0

  for (const entry of entries) {
    const lines = entry.text.split('\n')
    const keptLines: string[] = []
    let touchedThisCue = false

    for (const raw of lines) {
      const tagsHere = raw.match(SOUND_TAG_RE)?.length ?? 0

      if (isPureSoundLine(raw)) {
        // Nothing but a sound description — the line has no reason to exist.
        touchedThisCue = touchedThisCue || tagsHere > 0
        removedTags += tagsHere
        continue
      }

      if (tagsHere > 0) {
        // Dialogue plus a sound tag: keep the words, drop the description.
        removedTags += tagsHere
        touchedThisCue = true
        const cleaned = stripTagsFromLine(raw)
        // Guard against a line that was markup-only once tags were removed.
        if (cleaned.replace(MARKUP_RE, '').trim() === '') continue
        keptLines.push(cleaned)
      } else {
        keptLines.push(raw)
      }
    }

    if (keptLines.length === 0) {
      removedCues++
      continue
    }
    if (touchedThisCue) cleanedCues++
    out.push({ ...entry, text: keptLines.join('\n') })
  }

  return {
    entries: out.map((e, i) => ({ ...e, id: String(i + 1) })),
    removedCues,
    cleanedCues,
    removedTags
  }
}
