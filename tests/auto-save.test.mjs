import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules, projectPath } from './helpers/load-module.mjs'

const { autoSaveName, planAutoSave, shouldAutoSave } = await loadModules(`
  export { autoSaveName, planAutoSave, shouldAutoSave } from '${projectPath('renderer/src/lib/auto-save.ts')}'
`)

const cue = (text) => ({ id: '1', startTime: '00:00:01,000', endTime: '00:00:02,000', text })

// ─────────────────────── Naming: MKV-extracted ───────────────────────
// The name must match the movie EXACTLY, or the player will not auto-load it.

test('an MKV-extracted translation keeps the movie name verbatim', () => {
  assert.equal(autoSaveName('Movie.srt', true), 'Movie.srt')
  assert.equal(
    autoSaveName('Dark.Matter.2024.S02E01.1080p.WEBRip.x265-PSA.srt', true),
    'Dark.Matter.2024.S02E01.1080p.WEBRip.x265-PSA.srt'
  )
})

test('a movie name with spaces survives intact', () => {
  assert.equal(autoSaveName('The Whisper Man (2026).srt', true), 'The Whisper Man (2026).srt')
})

// ─────────────────────── Naming: plain .srt import ───────────────────────
// No movie to match, so a marker keeps the translation distinct from the source.

test('a plain .srt import gets a distinct name', () => {
  assert.equal(autoSaveName('Movie.srt', false), 'Movie.si.srt')
})

test('the marker is stable — it does not stack across runs', () => {
  // The real bug: re-importing an already-marked file produced
  // "Movie.si.si.srt", and auto-saving on every completion would have added a
  // new suffix each time.
  assert.equal(autoSaveName('Movie.si.srt', false), 'Movie.si.srt')
  assert.equal(autoSaveName('Movie.si.si.srt', false), 'Movie.si.srt')
})

test('naming is idempotent for every case', () => {
  for (const name of ['Movie.srt', 'Movie.si.srt', 'a.b.c.srt', 'S01E01.srt']) {
    const once = autoSaveName(name, false)
    assert.equal(autoSaveName(once, false), once, `${name} should stabilise after one pass`)
  }
})

test('the marker is not confused by dots in the movie name', () => {
  assert.equal(autoSaveName('Dark.Matter.S02E01.srt', false), 'Dark.Matter.S02E01.si.srt')
})

// ─────────────────────────── Overwrite reporting ───────────────────────────

test('reports when the target already exists', () => {
  const plan = planAutoSave('Movie.srt', true, '/movies', (name) => name === 'Movie.srt')
  assert.equal(plan.name, 'Movie.srt')
  assert.equal(plan.dir, '/movies')
  assert.equal(plan.overwrote, true)
})

test('reports no overwrite when the target is free', () => {
  const plan = planAutoSave('Movie.srt', true, '/movies', () => false)
  assert.equal(plan.overwrote, false)
})

test('without a directory there is nothing to overwrite', () => {
  const plan = planAutoSave('Movie.srt', true, undefined, () => true)
  assert.equal(plan.dir, undefined)
  assert.equal(plan.overwrote, false)
})

test('the plan carries only the name, never a joined path', () => {
  // The main process joins with path.join, so the separator is correct on
  // Windows too. A name containing "/" would break that.
  const plan = planAutoSave('Movie.srt', true, 'C:\\Movies', () => false)
  assert.ok(!plan.name.includes('/'), 'name must not embed a separator')
  assert.ok(!plan.name.includes('\\'), 'name must not embed a separator')
})

// ───────────────────────── What gets auto-saved ─────────────────────────

test('a complete successful translation is saved automatically', () => {
  assert.equal(
    shouldAutoSave({ success: true, entries: [cue('x')], incomplete: false, cancelled: false }),
    true
  )
})

test('an incomplete result is NOT saved automatically', () => {
  // A part-English file beside the movie would be auto-loaded by the player and
  // silently produce broken subtitles — worse than no file at all.
  assert.equal(
    shouldAutoSave({ success: true, entries: [cue('x')], incomplete: true, cancelled: false }),
    false
  )
})

test('a cancelled job is NOT saved automatically', () => {
  assert.equal(
    shouldAutoSave({ success: false, entries: null, incomplete: false, cancelled: true }),
    false
  )
})

test('a failed job is NOT saved automatically', () => {
  assert.equal(
    shouldAutoSave({ success: false, entries: null, incomplete: false, cancelled: false }),
    false
  )
})

test('an empty result is NOT saved automatically', () => {
  assert.equal(
    shouldAutoSave({ success: true, entries: [], incomplete: false, cancelled: false }),
    false
  )
})
