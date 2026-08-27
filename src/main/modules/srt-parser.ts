import type { SubtitleEntry } from '@shared/types'

export function parseSrt(content: string): SubtitleEntry[] {
  let text = content.replace(/^﻿/, '')
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const blocks = text.split(/\n\n+/).filter(b => b.trim())
  const entries: SubtitleEntry[] = []
  const timestampRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    let timestampLineIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (timestampRegex.test(lines[i])) {
        timestampLineIndex = i
        break
      }
    }

    if (timestampLineIndex === -1) continue

    const match = lines[timestampLineIndex].match(timestampRegex)
    if (!match) continue

    const textLines = lines.slice(timestampLineIndex + 1).filter(l => l.trim())
    if (textLines.length === 0) continue

    entries.push({
      id: lines[0].trim(),
      startTime: match[1],
      endTime: match[2],
      text: textLines.join('\n')
    })
  }

  return entries
}

export function serializeSrt(entries: SubtitleEntry[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${e.startTime} --> ${e.endTime}\n${e.text}`)
    .join('\n\n') + '\n'
}

export function cleanAiResponse(response: string): string {
  const fenceMatch = response.match(/```(?:srt)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return response.trim()
}
