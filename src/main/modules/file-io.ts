import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename } from 'path'

export async function importSrtFile(): Promise<{ filePath: string; fileName: string; content: string } | null> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'SRT Subtitles', extensions: ['srt'] }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const content = await readFile(filePath, 'utf-8')
  return { filePath, fileName: basename(filePath), content }
}

export async function selectMkvFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'MKV/Matroska Movies', extensions: ['mkv'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function exportSrtFile(content: string, suggestedName: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters: [{ name: 'SRT Subtitles', extensions: ['srt'] }]
  })

  if (result.canceled || !result.filePath) return null

  await writeFile(result.filePath, content, 'utf-8')
  return result.filePath
}
