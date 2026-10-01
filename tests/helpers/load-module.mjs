/**
 * Test helper: load a TypeScript module from the renderer/main source tree.
 *
 * WHY THIS EXISTS: the tests exercise the REAL modules, not copies. Transpiling
 * with the project's own esbuild means a test cannot pass against a stale or
 * hand-edited duplicate — if the source changes in a way the test disagrees
 * with, the test fails. It also resolves the `@shared/*` alias, which plain
 * `node --test` cannot do on TypeScript.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolve from THIS file, not from the test that imported it — import.meta.dirname
// inside a helper can differ from the caller's directory.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ESBUILD = join(ROOT, 'node_modules', '.bin', 'esbuild')

/**
 * Bundle the given source modules into one ESM file and import it.
 *
 * @param entrySource  ESM source re-exporting what the test needs, e.g.
 *                     `export { cleanupSubtitles } from '...'`
 * @returns the imported module namespace
 */
export function loadModules(entrySource, { electronStub = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'srt-test-'))
  const entry = join(dir, 'entry.ts')
  const out = join(dir, 'bundle.mjs')
  writeFileSync(entry, entrySource)

  // Modules that import `electron` cannot run outside Electron. When a stub is
  // supplied, write it as a real module and alias `electron` to it — an
  // `--external:electron` bundle would fail at import time with
  // ERR_MODULE_NOT_FOUND, because the bare specifier is not resolvable in Node.
  const args = [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--loader:.ts=ts',
    `--alias:@shared=${join(ROOT, 'src/shared')}`,
    `--outfile=${out}`
  ]

  if (electronStub) {
    const stubPath = join(dir, 'electron-stub.mjs')
    writeFileSync(stubPath, electronStub)
    args.push(`--alias:electron=${stubPath}`)
  } else {
    args.push('--external:electron')
  }

  try {
    execFileSync(ESBUILD, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(`esbuild failed for test bundle:\n${err.stderr?.toString() ?? err.message}`)
  }

  // The bundle is imported by URL; the temp dir is removed when the process ends.
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup.
    }
  })

  return import(pathToFileURL(out).href)
}

/** Absolute path to a project file, so tests do not depend on cwd. */
export function projectPath(...parts) {
  return join(ROOT, ...parts)
}
