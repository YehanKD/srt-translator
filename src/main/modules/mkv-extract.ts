import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, basename, dirname, extname } from 'path'
import { parseSrt } from './srt-parser'
import type { SubtitleEntry } from '@shared/types'

const execFileP = promisify(execFile)

export interface MkvSubtitleTrack {
  id: number
  codecId: string
  codec: string
  language: string
  trackName: string
  isText: boolean
}

// Text-based subtitle codecs — directly translatable. Everything else
// (S_HDMV/PGS, S_VOBSUB, S_HDMV/TEXTST, S_DVBSUB…) is image-based and needs OCR.
const TEXT_CODEC_PREFIXES = ['S_TEXT/']

function isTextCodec(codecId: string): boolean {
  return TEXT_CODEC_PREFIXES.some((p) => codecId.startsWith(p))
}

function codecDisplay(codecId: string): string {
  const map: Record<string, string> = {
    'S_TEXT/UTF8': 'SRT',
    'S_TEXT/ASS': 'ASS',
    'S_TEXT/SSA': 'SSA',
    'S_TEXT/USF': 'USF',
    'S_TEXT/WEBVTT': 'WebVTT',
    'S_TEXT/ASCII': 'ASCII',
    'S_HDMV/PGS': 'PGS (image)',
    'S_VOBSUB': 'VobSub (image)',
    'S_HDMV/TEXTST': 'HDMV TextST (image)'
  }
  return map[codecId] || codecId
}

// Bundled tools ship with the app (extraResources → resources/tools) so the
// extract feature works on a fresh machine with zero external installs.
// Fallbacks: dev mode (project resources), system PATH dirs, and a
// system-wide MKVToolNix install (Windows only). Binary names are
// platform-specific: `*.exe` on Windows, bare `mkvmerge`/`mkvextract` on
// Linux/macOS (installed via pacman/apt/brew, or copied next to the app).
function mkvToolName(base: 'mkvmerge' | 'mkvextract'): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

const MKVTOOLNIX_CANDIDATES: string[] = [
  join(process.resourcesPath, 'tools'),
  join(process.cwd(), 'resources', 'tools'),
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin'
]
if (process.platform === 'win32') {
  MKVTOOLNIX_CANDIDATES.push('C:\\Program Files\\MKVToolNix', 'C:\\Program Files (x86)\\MKVToolNix')
}

let cachedMkvToolNixDir: string | null | undefined

export function findMkvToolNixDir(): string | null {
  if (cachedMkvToolNixDir !== undefined) return cachedMkvToolNixDir
  for (const dir of MKVTOOLNIX_CANDIDATES) {
    if (
      existsSync(join(dir, mkvToolName('mkvmerge'))) &&
      existsSync(join(dir, mkvToolName('mkvextract')))
    ) {
      cachedMkvToolNixDir = dir
      return dir
    }
  }
  cachedMkvToolNixDir = null
  return null
}

async function runTool(tool: 'mkvmerge' | 'mkvextract', args: string[]): Promise<string> {
  const dir = findMkvToolNixDir()
  if (!dir) {
    const hint =
      process.platform === 'win32'
        ? 'Install MKVToolNix from https://mkvtoolnix.download or copy the tools next to the app.'
        : 'Install it with: sudo pacman -S mkvtoolnix-cli   (Debian/Ubuntu: sudo apt install mkvtoolnix)'
    throw new Error(`MKVToolNix not found. ${hint}`)
  }
  const { stdout, stderr } = await execFileP(join(dir, tool), args, {
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  })
  return stderr ? `${stdout}\n${stderr}` : stdout
}

export async function getMkvSubtitleTracks(mkvPath: string): Promise<MkvSubtitleTrack[]> {
  const raw = await runTool('mkvmerge', ['-J', mkvPath])
  // mkvextract is silent; mkvmerge -J prints pure JSON. If the file is not an
  // MKV it returns a JSON "errors" object instead of "tracks".
  const parsed = JSON.parse(raw)
  const tracks: Array<Record<string, unknown>> = parsed.tracks || []
  return tracks
    .filter((t) => t.type === 'subtitles')
    .map((t) => {
      const props = (t.properties || {}) as Record<string, unknown>
      const codecId = String(props.codec_id ?? t.codec_id ?? '')
      const language = String(props.language ?? t.language ?? 'und')
      const trackName = String(props.track_name ?? t.name ?? '').trim()
      return {
        id: Number(t.id),
        codecId,
        codec: codecDisplay(codecId),
        language,
        trackName,
        isText: isTextCodec(codecId)
      }
    })
}

// Minimal ASS/SSA → SRT conversion (text + timing only; styling is dropped).
export function assToSrt(assText: string): string {
  const blocks: string[] = []
  let counter = 1
  for (const line of assText.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue
    const parts = line.split(',')
    if (parts.length < 10) continue
    // "Dialogue: 0,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"
    // → parts[0]="Dialogue: 0" (Layer), Start=parts[1], End=parts[2], Text=parts[9..]
    const startRaw = parts[1]
    const endRaw = parts[2]
    const text = parts
      .slice(9)
      .join(',')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/\{[^}]*\}/g, '') // override tags {\an8}, {\i1}…
      .replace(/<\/?[ibu]>/gi, '')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
    if (!text) continue
    blocks.push(`${counter}\n${assTimeToSrt(startRaw)} --> ${assTimeToSrt(endRaw)}\n${text}`)
    counter += 1
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '')
}

function assTimeToSrt(t: string): string {
  // ASS: H:MM:SS.cc  (centiseconds)  → SRT: HH:MM:SS,mmm
  const m = t.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})$/)
  if (!m) return t.trim()
  const [, h, mi, s, cs] = m
  const ms = String(Math.round(Number(cs) * 10)).padStart(3, '0')
  return `${String(h).padStart(2, '0')}:${mi.padStart(2, '0')}:${s.padStart(2, '0')},${ms}`
}

function subtitleExtensionFor(codecId: string): string {
  if (codecId === 'S_TEXT/ASS' || codecId === 'S_TEXT/SSA') return '.ass'
  return '.srt'
}

export interface MkvExtractionResult {
  fileName: string
  /** Folder the MKV lives in — used to default the export dialog there. */
  sourceDir?: string
  entries: SubtitleEntry[]
}

/**
 * Extract one subtitle track from an MKV into a temp file, convert to SRT,
 * parse and return the entries. Image-based tracks (PGS/VobSub) throw a typed
 * error so the UI can explain why it can't translate them.
 */
export async function extractMkvSubtitleTrack(
  mkvPath: string,
  track: MkvSubtitleTrack
): Promise<MkvExtractionResult> {
  if (!track.isText) {
    const err = new Error(
      `Subtitle track ${track.id} is image-based (${track.codec}) and cannot be translated without OCR. Pick a text subtitle track (SRT/ASS).`
    ) as Error & { code?: string }
    err.code = 'IMAGE_SUBTITLE'
    throw err
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'srt-translator-'))
  try {
    const ext = subtitleExtensionFor(track.codecId)
    const outFile = join(tmpDir, `track${track.id}${ext}`)
    await runTool('mkvextract', [mkvPath, 'tracks', `${track.id}:${outFile}`])

    let content = await readFile(outFile, 'utf-8')
    if (ext === '.ass') content = assToSrt(content)

    const entries = parseSrt(content)
    if (entries.length === 0) {
      throw new Error(`Extracted subtitle track ${track.id} is empty or unreadable.`)
    }

    // Name the extracted subtitle EXACTLY after the MKV (no track label).
    //
    // It previously read `${mkvBase} - ${label}.srt`, which produced names like
    // "Movie.Name.2024 - ENGLISH.srt". Exported next to the movie that never
    // matches, so the player would not pick the subtitle up automatically.
    // Keeping the base name identical to the MKV means the exported
    // "...si.srt" sits beside "....mkv" and every player auto-loads it.
    const mkvBase = basename(mkvPath, extname(mkvPath))
    // The movie's own folder, so the export dialog can default there. A
    // matching filename in the wrong folder is still not auto-loaded.
    return { fileName: `${mkvBase}.srt`, sourceDir: dirname(mkvPath), entries }
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
