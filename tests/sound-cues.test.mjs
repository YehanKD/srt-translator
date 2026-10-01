import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules } from './helpers/load-module.mjs'
import { parseSrtFile, cue, resetCueCounter } from './helpers/srt-fixture.mjs'
import { projectPath } from './helpers/load-module.mjs'

const { stripSoundCues } = await loadModules(`
  export { stripSoundCues } from '${projectPath('renderer/src/lib/sound-cues.ts')}'
`)

const run = (...texts) => {
  resetCueCounter()
  return stripSoundCues(texts.map((t) => cue(t)))
}
const only = (text) => run(text).entries[0]?.text

test('drops a cue that is only a bracketed sound description', () => {
  assert.equal(run('[coroner sighs]').entries.length, 0)
  assert.equal(run('[door opens]').entries.length, 0)
})

test('drops dash-prefixed sound lines', () => {
  const r = run('- [indistinct police chatter]\n- [sirens wailing in distance]')
  assert.equal(r.entries.length, 0)
})

test('strips a sound tag that sits beside dialogue, keeping the words', () => {
  assert.equal(only('[sighs] Thanks.'), 'Thanks.')
  assert.equal(only('Well... [sighs]'), 'Well...')
  assert.equal(only('The [REDACTED] file.'), 'The file.')
})

test('keeps dialogue when a dash-led sound line accompanies it', () => {
  const r = run('- [chuckles]\n- Mmm, but how will I have my coffee?')
  assert.equal(r.entries[0].text, '- Mmm, but how will I have my coffee?')
})

test('drops sound lines around dialogue, keeping only the dialogue', () => {
  const r = run('[a]\nReal line here.\n[b]')
  assert.equal(r.entries[0].text, 'Real line here.')
})

test('removes markup-wrapped sound tags', () => {
  assert.equal(run('<i>[door slams]</i>').entries.length, 0)
  assert.equal(run('{\\an8}[door closes]').entries.length, 0)
})

// ── Dialogue safety: these must NEVER be touched ──

test('keeps a parenthesised translation (not a sound tag)', () => {
  assert.equal(only('රිකනයිසන්ස් (Reconnaissance).'), 'රිකනයිසන්ස් (Reconnaissance).')
})

test('keeps a mid-sentence parenthetical aside', () => {
  assert.equal(only('The plan (such as it is) worked.'), 'The plan (such as it is) worked.')
})

test('keeps a parenthetical aside at the start of dialogue', () => {
  assert.equal(only('(I think) you should go.'), '(I think) you should go.')
})

test('keeps ordinary two-speaker dialogue', () => {
  const text = '- What?\n- Nothing.'
  assert.equal(only(text), text)
})

test('keeps bare ALL-CAPS lines (ambiguous: could be shouting)', () => {
  assert.equal(only('MUSIC PLAYING'), 'MUSIC PLAYING')
})

test('does not treat an unclosed bracket as a tag', () => {
  assert.equal(only('[unclosed bracket'), '[unclosed bracket')
})

// ── Accounting ──

test('counts removed cues, cleaned cues and tags', () => {
  const r = run('[x]', '[y] Hello.', 'Plain.')
  assert.equal(r.removedCues, 1)
  assert.equal(r.cleanedCues, 1)
  assert.equal(r.removedTags, 2)
})

test('renumbers output ids from 1', () => {
  const r = run('[a]', 'Keep one.', 'Keep two.')
  assert.deepEqual(r.entries.map((e) => e.id), ['1', '2'])
})

test('is idempotent — a second pass removes nothing', () => {
  const once = run('[sighs] Thanks.', '[door]', '- [a]\n- Hello.')
  const twice = stripSoundCues(once.entries)
  assert.equal(twice.removedCues, 0)
  assert.equal(twice.removedTags, 0)
})

test('does not mutate the caller\'s entries', () => {
  const entries = [cue('[sighs] Thanks.')]
  const snapshot = JSON.stringify(entries)
  stripSoundCues(entries)
  assert.equal(JSON.stringify(entries), snapshot)
})

test('handles empty input', () => {
  const r = stripSoundCues([])
  assert.equal(r.entries.length, 0)
  assert.equal(r.removedCues, 0)
})

// ── Real file ──

test('cleans a real SDH track with no sound tags left behind', () => {
  const entries = parseSrtFile(projectPath('tests/fixtures/sdh-basic.srt'))
  const r = stripSoundCues(entries)
  const joined = r.entries.map((e) => e.text).join('\n')

  assert.ok(!/\[[^\]]*\]/.test(joined), 'square-bracket sound tags must not survive')
  assert.ok(r.entries.every((e) => e.text.trim().length > 0), 'no empty cues')

  // Dialogue must be intact.
  assert.ok(joined.includes("You're joking, right?"))
  assert.ok(joined.includes('Show me the bodies.'))
  assert.ok(joined.includes('to look like dead people?'))

  // Sound-only cues must be gone.
  assert.ok(!joined.includes('coroner sighs'))
  assert.ok(!joined.includes('ominous music playing'))
  assert.ok(!joined.includes('sirens wailing'))
})
