import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules, projectPath } from './helpers/load-module.mjs'

const { relativeReset, isRollingPlaceholder, quotaForModel } = await loadModules(`
  export { relativeReset, isRollingPlaceholder, quotaForModel } from '${projectPath('renderer/src/lib/quota.ts')}'
`)

const inMs = (ms) => new Date(Date.now() + ms).toISOString()

// ───────────────────── The rolling-placeholder bug ─────────────────────
// Measured against Gemini: while a 5-hour window is untouched, the API reports
// "now + 5h" on every call. Sampling 96s apart moved it forward 96s, so the
// countdown sat at "5h" forever and looked like it reset on every app launch.

test('detects a 5-hour placeholder reported as now + 5h', () => {
  assert.equal(isRollingPlaceholder(inMs(5 * 3600 * 1000), 5), true)
})

test('tolerates the few seconds of jitter seen in practice', () => {
  assert.equal(isRollingPlaceholder(inMs(5 * 3600 * 1000 - 30_000), 5), true)
  assert.equal(isRollingPlaceholder(inMs(5 * 3600 * 1000 + 30_000), 5), true)
})

test('a genuinely part-way window is NOT a placeholder', () => {
  // The tolerance only covers the first few minutes of a fresh window. A window
  // already under way is well clear of it and shows a real countdown.
  assert.equal(isRollingPlaceholder(inMs(294 * 60 * 1000), 5), false)
  assert.equal(isRollingPlaceholder(inMs(280 * 60 * 1000), 5), false)
  assert.equal(isRollingPlaceholder(inMs(40 * 60 * 1000), 5), false)
})

test('only the first few minutes of a fresh window are treated as a placeholder', () => {
  // Documents the accepted cost: a real window with ~5h left is indistinguishable
  // from the placeholder, so the countdown is hidden for those first minutes.
  // That is a deliberate trade — a countdown stuck at "5h" is worse than none.
  assert.equal(isRollingPlaceholder(inMs(299 * 60 * 1000), 5), true)
  assert.equal(isRollingPlaceholder(inMs(294 * 60 * 1000), 5), false)
})

test('the weekly window is not treated as a 5-hour placeholder', () => {
  // 7 days ahead is a real timestamp for the weekly limit.
  assert.equal(isRollingPlaceholder(inMs(7 * 24 * 3600 * 1000), 5), false)
})

test('null and invalid values are not placeholders', () => {
  assert.equal(isRollingPlaceholder(null, 5), false)
  assert.equal(isRollingPlaceholder('not a date', 5), false)
})

test('a placeholder would otherwise render as a stuck "5h"', () => {
  // Demonstrates the old behaviour: relativeReset has no way to know.
  assert.equal(relativeReset(inMs(5 * 3600 * 1000)), '5h')
})

// ───────────────────────── Countdown formatting ─────────────────────────

test('formats minutes, hours and days', () => {
  assert.equal(relativeReset(inMs(45 * 60 * 1000)), '45m')
  assert.equal(relativeReset(inMs((3 * 60 + 13) * 60 * 1000)), '3h 13m')
  assert.equal(relativeReset(inMs(4 * 3600 * 1000)), '4h')
  assert.equal(relativeReset(inMs(2 * 24 * 3600 * 1000)), '2d')
})

test('a past or missing reset returns null', () => {
  assert.equal(relativeReset(inMs(-60_000)), null)
  assert.equal(relativeReset(null), null)
})

// ─────────────────────────── Model selection ───────────────────────────

test('quotaForModel returns the requested model only', () => {
  const models = [
    { id: 'a', name: 'A', used: 0, total: 1000, remainingPercentage: 100, resetAt: null, unlimited: false, fractionReported: true },
    { id: 'b', name: 'B', used: 900, total: 1000, remainingPercentage: 10, resetAt: null, unlimited: false, fractionReported: true }
  ]
  assert.equal(quotaForModel(models, 'a')?.id, 'a')
  assert.equal(quotaForModel(models, 'b')?.id, 'b')
})

test('quotaForModel ignores unlimited models and unknown ids', () => {
  const models = [
    { id: 'u', name: 'U', used: 0, total: 0, remainingPercentage: 100, resetAt: null, unlimited: true, fractionReported: true }
  ]
  assert.equal(quotaForModel(models, 'u'), null)
  assert.equal(quotaForModel(models, 'missing'), null)
  assert.equal(quotaForModel(models, null), null)
})
