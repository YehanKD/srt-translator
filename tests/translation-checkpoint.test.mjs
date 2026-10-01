import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModules, projectPath } from './helpers/load-module.mjs'
import { cue, resetCueCounter } from './helpers/srt-fixture.mjs'

// The checkpoint module calls electron's app.getPath('userData'), so point it at
// a temp dir. The env var is set BEFORE the module is loaded.
const userData = mkdtempSync(join(tmpdir(), 'srt-ckpt-'))
process.env.SRT_TEST_USERDATA = userData
mkdirSync(join(userData, 'checkpoints'), { recursive: true })

const { fingerprintJob, loadCheckpoint, saveCheckpoint, clearCheckpoint, pruneCheckpoints } =
  await loadModules(
    `export const { fingerprintJob, loadCheckpoint, saveCheckpoint, clearCheckpoint, pruneCheckpoints } =
       await import('${projectPath('src/main/modules/translation-checkpoint.ts')}')`,
    { electronStub: `export const app = { getPath: () => process.env.SRT_TEST_USERDATA }` }
  )

const entries = () => {
  resetCueCounter()
  return [cue('Line one.'), cue('Line two.'), cue('Line three.')]
}
const chunkOf = (text) => [{ id: '1', startTime: '00:00:01,000', endTime: '00:00:02,000', text }]

// ─────────────────────────── Fingerprint ───────────────────────────

test('same cues and model produce the same fingerprint', () => {
  assert.equal(fingerprintJob(entries(), 'gemini-3.1-pro-low'), fingerprintJob(entries(), 'gemini-3.1-pro-low'))
})

test('a different model produces a different fingerprint', () => {
  assert.notEqual(fingerprintJob(entries(), 'gemini-3.1-pro-low'), fingerprintJob(entries(), 'gemini-2.5-flash'))
})

test('edited cue text produces a different fingerprint', () => {
  const a = entries()
  const b = entries()
  b[1] = { ...b[1], text: 'changed' }
  assert.notEqual(fingerprintJob(a, 'm'), fingerprintJob(b, 'm'))
})

test('a different cue count produces a different fingerprint', () => {
  const a = entries()
  const b = [...entries(), { id: '9', startTime: '00:01:00,000', endTime: '00:01:01,000', text: 'extra' }]
  assert.notEqual(fingerprintJob(a, 'm'), fingerprintJob(b, 'm'))
})

test('a changed timestamp produces a different fingerprint', () => {
  const a = entries()
  const b = entries()
  b[0] = { ...b[0], startTime: '99:00:00,000' }
  assert.notEqual(fingerprintJob(a, 'm'), fingerprintJob(b, 'm'))
})

// ────────────────────────── Save / load ──────────────────────────

test('loading before saving returns null', () => {
  assert.equal(loadCheckpoint(fingerprintJob(entries(), 'fresh')), null)
})

test('a saved checkpoint round-trips with its chunks intact', () => {
  const fp = fingerprintJob(entries(), 'roundtrip')
  saveCheckpoint({
    fingerprint: fp,
    chunks: { '0': chunkOf('translated') },
    totalChunks: 3,
    modelId: 'roundtrip',
    savedAt: Date.now()
  })
  const back = loadCheckpoint(fp)
  assert.ok(back, 'checkpoint should load')
  assert.equal(Object.keys(back.chunks).length, 1)
  assert.equal(back.chunks['0'][0].text, 'translated')
  clearCheckpoint(fp)
})

test('clearing a checkpoint makes it unloadable', () => {
  const fp = fingerprintJob(entries(), 'toclear')
  saveCheckpoint({ fingerprint: fp, chunks: { '0': chunkOf('x') }, totalChunks: 1, modelId: 'toclear', savedAt: Date.now() })
  clearCheckpoint(fp)
  assert.equal(loadCheckpoint(fp), null)
})

test('a checkpoint whose stored fingerprint does not match is rejected', () => {
  const fp = fingerprintJob(entries(), 'owner')
  saveCheckpoint({ fingerprint: 'someone-else', chunks: { '0': chunkOf('x') }, totalChunks: 1, modelId: 'x', savedAt: Date.now() })
  assert.equal(loadCheckpoint(fp), null)
})

test('an expired checkpoint is rejected', () => {
  const fp = fingerprintJob(entries(), 'expired')
  // Written directly: saveCheckpoint always stamps savedAt to now, so an old
  // timestamp cannot be injected through it.
  writeFileSync(
    join(userData, 'checkpoints', `${fp}.json`),
    JSON.stringify({
      fingerprint: fp,
      chunks: { '0': chunkOf('x') },
      totalChunks: 1,
      modelId: 'expired',
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000
    })
  )
  assert.equal(loadCheckpoint(fp), null)
})

test('a corrupt checkpoint returns null instead of throwing', () => {
  writeFileSync(join(userData, 'checkpoints', 'deadbeef.json'), '{not json')
  assert.equal(loadCheckpoint('deadbeef'), null)
})

test('a checkpoint missing required fields is rejected', () => {
  writeFileSync(join(userData, 'checkpoints', 'nofields.json'), JSON.stringify({ fingerprint: 'nofields' }))
  assert.equal(loadCheckpoint('nofields'), null)
})

test('pruning does not throw and keeps recent checkpoints', () => {
  const fp = fingerprintJob(entries(), 'survivor')
  saveCheckpoint({ fingerprint: fp, chunks: { '0': chunkOf('x') }, totalChunks: 1, modelId: 'survivor', savedAt: Date.now() })
  assert.doesNotThrow(() => pruneCheckpoints())
  assert.ok(loadCheckpoint(fp), 'a recent checkpoint must survive pruning')
})
