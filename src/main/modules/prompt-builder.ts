import type { SubtitleChunk, SubtitleEntry } from '@shared/types'
import { TRANSLATION_PROMPT } from '@shared/constants'

export function buildMessages(chunk: SubtitleChunk): Array<{ role: string; content: string }> {
  const srtBlock = chunk.subtitles
    .map((s: SubtitleEntry) => `${s.id}\n${s.startTime} --> ${s.endTime}\n${s.text}`)
    .join('\n\n')

  return [
    { role: 'system', content: TRANSLATION_PROMPT },
    { role: 'user', content: srtBlock }
  ]
}
