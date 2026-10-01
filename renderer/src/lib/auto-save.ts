import type { SubtitleEntry } from '@shared/types'

/**
 * Where the translation is written, and under what name.
 *
 * WHY AUTO-SAVE: the whole naming scheme exists so a player auto-loads the
 * subtitle beside its movie. A manual save step defeated that — you had to
 * remember to click, and the file only landed in the right place if you did.
 *
 * The name must match the movie EXACTLY, which is why an MKV-extracted
 * translation is written as "Movie.srt" beside "Movie.mkv". A plain .srt import
 * has no movie to match, so it keeps a marker to stay distinct from its source.
 */

/**
 * The name to save under.
 *
 * For an MKV the source name is already the movie's ("Movie.srt") and is used
 * verbatim — anything inserted before ".srt" stops the player matching it.
 *
 * For a plain .srt import the marker keeps the translation distinct from the
 * user's own file. The marker is stripped before being re-applied, so the name
 * is STABLE across runs: without that, translating "Movie.si.srt" produced
 * "Movie.si.si.srt", and auto-saving on every completion would stack a new
 * suffix each time.
 */
export function autoSaveName(sourceFileName: string, fromMkv: boolean): string {
  if (fromMkv) return sourceFileName
  const base = sourceFileName.replace(/(?:\.si)+\.srt$/i, '.srt').replace(/\.srt$/i, '')
  return `${base}.si.srt`
}

export interface AutoSavePlan {
  /** The file name to save under. */
  name: string
  /** The directory to save into, when the source had one. */
  dir?: string
}

/**
 * Decide the save name and directory.
 *
 * Only the NAME is computed here; the main process joins it with the directory
 * using `path.join`, so the separator is correct on every OS. Building a full
 * path with a literal "/" would silently produce a bad path on Windows.
 *
 * `exists` is injected so the overwrite decision is testable without a disk.
 * The user's instruction is explicit: the translation wins that filename, because
 * a subtitle that does not match its movie is useless. The caller still needs to
 * know a replacement happened so it can say so.
 */
export function planAutoSave(
  sourceFileName: string,
  fromMkv: boolean,
  dir?: string,
  exists?: (name: string, dir?: string) => boolean
): AutoSavePlan & { overwrote: boolean } {
  const name = autoSaveName(sourceFileName, fromMkv)
  const overwrote = dir && exists ? exists(name, dir) : false
  return { name, dir, overwrote }
}

/**
 * Should this result be saved automatically?
 *
 * Only a clean, complete translation is written on its own. An INCOMPLETE result
 * is deliberately left alone: a part-English file sitting beside the movie would
 * be auto-loaded by the player and silently produce broken subtitles, which is
 * worse than no file at all. That case keeps the manual button.
 */
export function shouldAutoSave(result: {
  success: boolean
  entries: SubtitleEntry[] | null
  incomplete: boolean
  cancelled: boolean
}): boolean {
  if (!result.success || result.cancelled || result.incomplete) return false
  return Array.isArray(result.entries) && result.entries.length > 0
}
