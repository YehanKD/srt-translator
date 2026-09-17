import type { SubtitleEntry } from '@shared/types'

export function parseSrt(content: string): SubtitleEntry[] {
  let text = content.replace(/^\uFEFF/, '')
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const entries: SubtitleEntry[] = []
  const timestampRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/

  // Split on blank lines, BUT a cue's text may itself contain a blank line
  // (legal in SRT, and models emit it when translating two-line dialogue).
  // So: only treat a blank line as a separator when the block that follows
  // starts a NEW cue — i.e. its first non-empty line is a number and the next
  // is a timestamp, or it starts with a timestamp. Otherwise the blank line
  // belongs to the current cue's text.
  const rawBlocks = text.split(/\n{2,}/)
  const blocks: string[] = []
  for (const raw of rawBlocks) {
    if (!raw.trim()) continue
    const startsNewCue = (() => {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) return false
      // "123" followed by a timestamp line
      if (/^\d+\.?$/.test(lines[0]) && lines[1] && timestampRegex.test(lines[1])) return true
      // block begins directly with a timestamp
      return timestampRegex.test(lines[0])
    })()

    if (startsNewCue || blocks.length === 0) {
      blocks.push(raw)
    } else {
      // Continuation of the previous cue's text.
      blocks[blocks.length - 1] += '\n\n' + raw
    }
  }

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

    const textLines = lines.slice(timestampLineIndex + 1)
    // Trim leading/trailing blank lines but preserve interior ones.
    while (textLines.length && !textLines[0].trim()) textLines.shift()
    while (textLines.length && !textLines[textLines.length - 1].trim()) textLines.pop()
    if (textLines.length === 0) continue

    // The id is whatever precedes the timestamp (a bare number, usually).
    const idLine = timestampLineIndex > 0 ? lines[timestampLineIndex - 1].trim() : ''

    entries.push({
      id: idLine.replace(/\.$/, '') || String(entries.length + 1),
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
