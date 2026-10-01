import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModules, projectPath } from './helpers/load-module.mjs'

const userData = mkdtempSync(join(tmpdir(), 'srt-log-'))
process.env.SRT_TEST_USERDATA = userData

const { log, logFilePath } = await loadModules(
  `export const { log, logFilePath } = await import('${projectPath('src/main/modules/logger.ts')}')`,
  { electronStub: `export const app = { getPath: () => process.env.SRT_TEST_USERDATA }` }
)

const logPath = () => join(userData, 'app.log')
const readLog = () => readFileSync(logPath(), 'utf8')

test('writes a log file under userData', () => {
  log.info('hello from the test')
  assert.ok(existsSync(logPath()), 'app.log should exist')
  assert.ok(readLog().includes('hello from the test'))
})

test('records the level on each line', () => {
  log.info('an info line')
  log.warn('a warn line')
  log.error('an error line')
  const text = readLog()
  assert.ok(text.includes('[info] an info line'))
  assert.ok(text.includes('[warn] a warn line'))
  assert.ok(text.includes('[error] an error line'))
})

test('captures an Error stack, not just its message', () => {
  const err = new Error('something exploded')
  log.error('failed:', err)
  const text = readLog()
  assert.ok(text.includes('something exploded'))
  assert.ok(/at /.test(text), 'a stack frame should be recorded')
})

test('serialises non-string arguments without throwing', () => {
  assert.doesNotThrow(() => log.info('object:', { a: 1, b: [2, 3] }))
  assert.ok(readLog().includes('{"a":1'))
})

test('handles a circular object without throwing', () => {
  const circular = { name: 'loop' }
  circular.self = circular
  assert.doesNotThrow(() => log.info('circular:', circular))
})

test('logFilePath returns the file it writes to', () => {
  assert.equal(logFilePath(), logPath())
})

test('rotates an oversized log, keeping the file present afterwards', () => {
  // Cross the 2 MB threshold, then write once more. The rotation runs BEFORE the
  // append, so app.log must still exist and hold the newest line — rotating
  // afterwards left no app.log until the next write arrived.
  writeFileSync(logPath(), 'x'.repeat(2 * 1024 * 1024 + 10))
  log.info('after rotation')

  assert.ok(existsSync(`${logPath()}.1`), 'the oversized file should roll to .1')
  assert.ok(existsSync(logPath()), 'app.log must still exist after rotating')
  assert.ok(statSync(logPath()).size < 5000, 'the new log should start small')
  assert.ok(readLog().includes('after rotation'), 'the newest line belongs in the new file')
})
