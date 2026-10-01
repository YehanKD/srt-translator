import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'

/**
 * One dialog for both input kinds. The user shouldn't have to know whether a
 * subtitle lives inside a .mkv before they can open the picker, so the filter
 * offers subtitles and movies together and the extension decides what happens
 * next.
 */
const INPUT_FILTERS = [
  { name: 'Subtitles & Movies', extensions: ['srt', 'mkv'] },
  { name: 'SRT Subtitles', extensions: ['srt'] },
  { name: 'MKV Movies', extensions: ['mkv'] },
  { name: 'All Files', extensions: ['*'] }
]

export interface PickedFile {
  filePath: string
  fileName: string
  kind: 'srt' | 'mkv'
}

/**
 * Show the picker and classify the result by extension. Returns null when the
 * user cancels. Unknown extensions report as 'srt' so the caller's parse error
 * surfaces a readable message instead of a silent no-op.
 */
export async function pickInputFile(): Promise<PickedFile | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open a subtitle or movie',
    buttonLabel: 'Open',
    filters: INPUT_FILTERS,
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const fileName = basename(filePath)
  const kind = fileName.toLowerCase().endsWith('.mkv') ? 'mkv' : 'srt'
  return { filePath, fileName, kind }
}

/** Read and return an .srt's contents. */
export async function readSrtFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}

export async function selectMkvFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a movie',
    filters: [
      { name: 'MKV/Matroska Movies', extensions: ['mkv'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * Save the translated subtitles.
 *
 * `suggestedName` is a bare filename and `suggestDir` its intended folder. The
 * folder matters for auto-loading: players match a subtitle to a movie by
 * filename *in the same directory*, so defaulting to the movie's own folder
 * (when we know it) is what makes the exported file get picked up on play.
 */
export async function exportSrtFile(
  content: string,
  suggestedName: string,
  suggestedDir?: string
): Promise<string | null> {
  const defaultPath = suggestedDir
    ? join(suggestedDir, suggestedName)
    : suggestedName

  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'SRT Subtitles', extensions: ['srt'] }]
  })

  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, content, 'utf-8')
  return result.filePath
}
