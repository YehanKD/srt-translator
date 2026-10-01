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
 * Deliberately NOT handled here: bare ALL-CAPS lines ("MUSIC PLAYING").
 * ALL-CAPS is ambiguous — it is also how shouting is marked in ordinary
 * dialogue — so guessing there would delete real speech. Song lyrics are handled
 * separately in subtitle-cleanup.ts, which keys off the musical-note convention.
 */

/**
 * A bracketed sound description.
 *
 * `[ … ]` is unambiguous — subtitles do not use square brackets for dialogue —
 * so any span qualifies. Parentheses are NOT: real subtitles use `( … )` for
 * asides and translations ("රිකනයිසන්ස් (Reconnaissance).", "The plan (such as
 * it is) worked."). Stripping those deleted real words, so a parenthesised run
 * only counts as a sound description when it is a standalone line (handled by
 * isPureSoundLine) or when its content reads like one (see looksLikeSoundTag).
 */
const BRACKET_RE = /\[[^\]]*\]/g
const PAREN_RE = /\([^)]*\)/g

/**
 * Words that mark a parenthesised run as a sound description.
 *
 * Descriptions are short and almost always contain a verb of sound, an object
 * that makes noise, or a mood word ("door closes", "tense music playing").
 * Anything without such a word is treated as dialogue and kept.
 */
const SOUND_TAG_HINTS = [
  /\b(?:music|song|melody|tune)\b/i,
  /\b(?:sighs?|sighing|chuckles?|laughs?|laughing|giggles?|grunts?|grunting|groans?|moans?|gasps?|gasping|panting|breathing|breathes?|exhales?|inhales?|sniffles?|snorts?|coughs?|clears throat|whispers?|whispering|muttering|mumbles?|stammers?|stuttering|screams?|screaming|shouts?|yelling|crying|sobbing|sniffing)\b/i,
  /\b(?:door|doors|knock(?:s|ing)?|footsteps?|steps|thud|thuds|bang|bangs|crash|clatter|clattering|rustl\w+|creak\w*|slam\w*|click\w*|beep\w*|ring\w*|alarm|siren|sirens|phone|dial\w*|horn|whistle\w*|static|silence|quiet)\b/i,
  /\b(?:gunshot|gunfire|shots?|explosion|explodes|blaring|wailing|howling|barking|meows?|purring|chirp\w*|wind|rain|thunder|water|dishes|glass|paper|traffic|engine|crowd|chatter|applause|cheering)\b/i,
  /^(?:indistinct|distant|faint|muffled|unintelligible|soft|low|tense|ominous|upbeat|slow|fast|dramatic|gentle|angry|calm)\b/i
]

/**
 * True when a parenthesised run reads like a sound description rather than
 * dialogue. Conservative by design: an unknown run is KEPT, because dropping
 * real words is worse than translating one sound tag.
 *
 * A hint word is required. "Short and lowercase" was tried as an extra signal
 * and rejected: real asides look exactly like that ("such as it is"), and
 * deleting them costs dialogue, whereas the failure it guards against is a
 * single untranslated sound tag.
 */
function looksLikeSoundTag(inner: string): boolean {
  const t = inner.trim()
  if (!t) return true
  return SOUND_TAG_HINTS.some((re) => re.test(t))
}

/** Collect the sound-description spans in a line. */
function soundSpansIn(line: string): string[] {
  const spans = [...(line.match(BRACKET_RE) ?? [])]
  for (const m of line.match(PAREN_RE) ?? []) {
    if (looksLikeSoundTag(m.slice(1, -1))) spans.push(m)
  }
  return spans
}

/** Remove every sound-description span from a line. */
function removeSpans(line: string): string {
  let out = line.replace(BRACKET_RE, '')
  out = out.replace(PAREN_RE, (m) => (looksLikeSoundTag(m.slice(1, -1)) ? '' : m))
  return out
}

/** Formatting markup that carries no words: <i>, </i>, <font …>. */
const MARKUP_RE = /<\/?[a-zA-Z][^>]*>/g

/**
 * True when a line consists solely of bracketed runs (and dashes/markup).
 *
 * A whole line wrapped in brackets is a sound description in SDH regardless of
 * its wording — real dialogue asides are embedded in a sentence, never a line on
 * their own. This is the lenient check; mid-sentence stripping uses the stricter
 * looksLikeSoundTag, because there a parenthesis may be dialogue.
 */
const LINE_IS_ONLY_TAGS_RE = /^(?:\s*[-\u2013\u2014]?\s*(?:\[[^\]]*\]|\([^)]*\))\s*)+$/

/** True when a line has no words once tags and markup are removed. */
function isPureSoundLine(line: string): boolean {
  const stripped = line.replace(MARKUP_RE, '').trim()
  if (!stripped) return false
  if (!LINE_IS_ONLY_TAGS_RE.test(stripped)) return false
  // Must actually contain a bracketed run, so an empty-ish line is not dropped.
  return BRACKET_RE.test(stripped) || PAREN_RE.test(stripped)
}

/** Remove sound tags from a line and tidy the spacing left behind. */
function stripTagsFromLine(line: string): string {
  return removeSpans(line)
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
      const tagsHere = soundSpansIn(raw).length

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
