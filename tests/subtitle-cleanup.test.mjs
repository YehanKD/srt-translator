import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules, projectPath } from './helpers/load-module.mjs'
import { parseSrtFile, cue, resetCueCounter } from './helpers/srt-fixture.mjs'

const { cleanupSubtitles } = await loadModules(`
  export { cleanupSubtitles } from '${projectPath('renderer/src/lib/subtitle-cleanup.ts')}'
`)

const one = (text) => {
  resetCueCounter()
  return cleanupSubtitles([cue(text)])
}
const out = (text) => one(text).entries.map((e) => e.text)

// ─────────────────────────── Song lyrics ───────────────────────────

test('removes a line wrapped in musical notes', () => {
  assert.deepEqual(out('<i>♪ Maybe this time ♪</i>'), [])
  assert.deepEqual(out('♪ A ♪\n♪ B ♪'), [])
  assert.deepEqual(out('♫ double note ♫'), [])
  assert.deepEqual(out('- ♪ dash lyric ♪'), [])
})

test('removes a lyric that wraps across two lines as one unit', () => {
  const r = one('<i>♪ Maybe I can carve out\nA living in the cold ♪</i>')
  assert.equal(r.entries.length, 0)
  assert.equal(r.stats.musicLines, 2)
})

test('removes an unpaired lyric fragment', () => {
  assert.deepEqual(out('♪ opens but never closes'), [])
})

test('keeps the dialogue when a lyric shares the cue', () => {
  assert.deepEqual(out('♪ lyric ♪\nReal dialogue here.'), ['Real dialogue here.'])
})

test('a note mid-sentence is not a lyric (needs both ends)', () => {
  assert.deepEqual(out('He said "♪" was odd.'), ['He said "♪" was odd.'])
})

// ─────────────────────── ASS override tags ───────────────────────
// The real-world failure: "{\an8}" sits BEFORE the note, so a check that only
// stripped "<i>" saw a line not starting with ♪ and kept every lyric.

test('removes lyrics when an ASS tag precedes the note', () => {
  assert.deepEqual(out('{\\an8}<i>♪ Put on your dresses ♪</i>'), [])
  assert.deepEqual(out('{\\an8}<i>♪ Come over meadows\nAnd play ♪</i>'), [])
})

test('strips ASS tags from dialogue without losing words', () => {
  assert.deepEqual(out("{\\an8}Don't freak out."), ["Don't freak out."])
  assert.deepEqual(out('{\\pos(320,240)}Hello there.'), ['Hello there.'])
  assert.deepEqual(out('{\\c&H0000FF&}Red text.'), ['Red text.'])
})

test('strips HTML markup from dialogue', () => {
  assert.deepEqual(out('<i>Quirky Quinn</i>.'), ['Quirky Quinn.'])
})

test('keeps dialogue from a cue that also held a lyric', () => {
  assert.deepEqual(out('{\\an8}<i>♪ song line ♪</i>\n{\\an8}Real dialogue.'), ['Real dialogue.'])
})

// ───────────────────────── Speaker labels ─────────────────────────
// Tightened because the old rule damaged dialogue.

test('strips a plain speaker label', () => {
  assert.deepEqual(out('JASON: Hello there.'), ['Hello there.'])
  assert.deepEqual(out('- JASON: Hello.'), ['Hello.'])
  assert.deepEqual(out('FBI: Open up!'), ['Open up!'])
})

test('strips a label with a title abbreviation', () => {
  assert.deepEqual(out('DR. SMITH: Take two.'), ['Take two.'])
})

test('does NOT strip all-caps dialogue', () => {
  assert.deepEqual(out('I SAID: stop right now!'), ['I SAID: stop right now!'])
})

test('does NOT empty a line that is only a label', () => {
  assert.deepEqual(out('WAIT:'), ['WAIT:'])
  assert.deepEqual(out('NO ONE KNOWS:'), ['NO ONE KNOWS:'])
  assert.deepEqual(out('THE FOLLOWING IS A TRUE STORY:'), ['THE FOLLOWING IS A TRUE STORY:'])
})

test('does NOT strip an episode marker or a timecode', () => {
  assert.deepEqual(out('S02E01: The Beginning'), ['S02E01: The Beginning'])
  assert.deepEqual(out('It was 10:30 when he left.'), ['It was 10:30 when he left.'])
})

// ───────────────────────── Orchestration ─────────────────────────

test('renumbers ids and reports totals', () => {
  resetCueCounter()
  const r = cleanupSubtitles([cue('[door]'), cue('Keep this.'), cue('♪ song ♪')])
  assert.deepEqual(r.entries.map((e) => e.id), ['1'])
  assert.equal(r.stats.totalIn, 3)
  assert.equal(r.stats.totalOut, 1)
  assert.equal(r.stats.removedCues, 2)
})

test('is idempotent and deterministic', () => {
  const entries = parseSrtFile(projectPath('tests/fixtures/sdh-basic.srt'))
  const once = cleanupSubtitles(entries)
  const twice = cleanupSubtitles(once.entries)
  assert.equal(twice.stats.removedCues, 0, 'second pass must remove nothing')
  assert.equal(twice.stats.musicLines, 0, 'second pass must find no lyrics')
  assert.deepEqual(
    cleanupSubtitles(entries).entries,
    cleanupSubtitles(entries).entries,
    'two runs on the same input must be identical'
  )
})

// ─────────────────────── Real files, end to end ───────────────────────

test('cleans a real SDH track end to end', () => {
  const entries = parseSrtFile(projectPath('tests/fixtures/sdh-basic.srt'))
  const r = cleanupSubtitles(entries)
  const joined = r.entries.map((e) => e.text).join('\n')

  assert.ok(!/\[[^\]]*\]/.test(joined), 'no square-bracket tags may survive')
  assert.ok(!/\{\\/.test(joined), 'no ASS tags may survive')
  assert.ok(r.entries.every((e) => e.text.trim().length > 0), 'no empty cues')

  assert.ok(joined.includes("You're joking, right?"))
  assert.ok(joined.includes('Show me the bodies.'))
  assert.ok(joined.includes('රිකනයිසන්ස් (Reconnaissance).'))
  assert.ok(joined.includes('The plan (such as it is) worked.'))
})

test('removes every note symbol that brackets a lyric', () => {
  const entries = parseSrtFile(projectPath('tests/fixtures/sdh-basic.srt'))
  const r = cleanupSubtitles(entries)

  // A note symbol is only a lyric marker when it BRACKETS the line. The fixture
  // also contains dialogue that quotes a note mid-sentence ('He said "♪" was
  // odd.'), which must survive — so assert per line rather than over the whole
  // file, or that legitimate case reads as a failure.
  const survivors = r.entries.filter((e) => /[♪♫]/.test(e.text))
  for (const e of survivors) {
    const hasLeadingNote = e.text.split('\n').some((l) => /^\s*[♪♫]/.test(l))
    assert.ok(!hasLeadingNote, `a bracketed lyric survived: ${JSON.stringify(e.text)}`)
  }
  assert.equal(r.stats.musicLines, 4, 'four lyric lines should be counted')
})

test('cleans a track whose lyrics carry ASS positioning tags', () => {
  const entries = parseSrtFile(projectPath('tests/fixtures/sdh-ass-tags.srt'))
  const r = cleanupSubtitles(entries)
  const joined = r.entries.map((e) => e.text).join('\n')

  assert.ok(!/[♪♫]/.test(joined), 'no note symbols may survive')
  assert.ok(!/\{\\/.test(joined), 'no ASS tags may survive')
  assert.ok(!/<\/?i>/.test(joined), 'no HTML markup may survive')
  assert.ok(joined.includes('Quirky Quinn.'), 'dialogue words must survive')
  assert.ok(joined.includes('Do you know anyone named Quinn?'), 'names must survive')
})

// ─────────────────────── Dialogue-safety audit ───────────────────────
// The check that matters: every word the cleanup removed must be explainable by
// one of the rules' own target sets. Anything else is deleted dialogue.

test('removes only words that belong to a rule target set', () => {
  const files = ['sdh-basic.srt', 'sdh-ass-tags.srt']

  for (const name of files) {
    const entries = parseSrtFile(projectPath(`tests/fixtures/${name}`))
    const r = cleanupSubtitles(entries)

    // Strip markup AND surrounding punctuation. Without punctuation stripping
    // the same word tokenises differently on each side ("Quinn</i>." vs
    // "Quinn."), which reports a loss that is plainly still present.
    const words = (s) =>
      s
        .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
        .replace(/\{\\[^}]*\}/g, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
        .filter((w) => w.length > 0)

    const tally = (arr) => {
      const m = new Map()
      for (const w of arr) m.set(w, (m.get(w) ?? 0) + 1)
      return m
    }
    const before = tally(entries.flatMap((e) => words(e.text)))
    const after = tally(r.entries.flatMap((e) => words(e.text)))

    // Words that legitimately belong to a rule's target set.
    const tagWords = new Set()
    for (const e of entries) {
      for (const m of e.text.matchAll(/\[[^\]]*\]/g)) for (const w of words(m[0])) tagWords.add(w)
      for (const m of e.text.matchAll(/\([^)]*\)/g)) for (const w of words(m[0])) tagWords.add(w)
    }
    const lyricWords = new Set()
    for (const e of entries) {
      for (const line of e.text.split('\n')) {
        const t = line.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')
          .replace(/^\s*[-–—]\s*/, '').trim()
        if (/^[♪♫]/.test(t) || /[♪♫]$/.test(t)) for (const w of words(t)) lyricWords.add(w)
      }
    }
    const labelWords = new Set()
    for (const e of entries) {
      for (const line of e.text.split('\n')) {
        const m = line.match(/^\s*(?:[-–—]\s*)?([A-Za-z][A-Za-z.'\- ]{0,40}?):\s*/)
        if (m) for (const w of words(m[1])) labelWords.add(w)
      }
    }

    const unexplained = []
    for (const [w, n] of before) {
      const now = after.get(w) ?? 0
      if (now >= n) continue
      if (tagWords.has(w) || lyricWords.has(w) || labelWords.has(w)) continue
      unexplained.push(w)
    }

    assert.deepEqual(unexplained, [], `deleted dialogue in ${name}`)
  }
})
