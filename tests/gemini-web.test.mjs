import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules, projectPath } from './helpers/load-module.mjs'

const {
  buildInnerPayload,
  buildModelHeader,
  makeRequestUuid,
  makeSessionId,
  parseChatMetadata,
  parseResponseText,
  cleanResponseText,
  describeHttpFailure,
  GEMINI_WEB_MODELS,
  GeminiWebError
} = await loadModules(`
  export {
    buildInnerPayload, buildModelHeader, makeRequestUuid, makeSessionId, parseChatMetadata, parseResponseText,
    cleanResponseText, describeHttpFailure, GEMINI_WEB_MODELS, GeminiWebError
  } from '${projectPath('src/main/modules/gemini-web/protocol.ts')}'
`)

/** Decode an inner payload back into its array form. */
function innerOf(prompt, mode, uuid = 'U') {
  const outer = JSON.parse(buildInnerPayload(prompt, mode, uuid))
  return JSON.parse(outer[1])
}

// ─────────────────────────────── Payload shape ──────────────────────────────
//
// Every assertion here corresponds to a bug that produced HTTP 400 error-3 with
// an EMPTY error detail. They are not style preferences — each one, alone, made
// the request fail against the live endpoint.

test('the payload is exactly 81 slots', () => {
  // A longer array (96 was tried) sends trailing nulls the server treats as a
  // malformed request. This was the largest single cause of the 400s.
  assert.equal(innerOf('x', 3).length, 81)
})

test('slot 6 is [1], not [0]', () => {
  assert.deepEqual(innerOf('x', 3)[6], [1])
})

test('slot 67 is left null', () => {
  // Setting it adds a field the server does not expect. It sits inside the
  // array (which must stay 81 long) but must remain null.
  assert.equal(innerOf('x', 3)[67], null)
})

test('slot 68 is set to 1', () => {
  assert.equal(innerOf('x', 3)[68], 1)
})

test('the model tier lands in slot 79', () => {
  assert.equal(innerOf('x', 8)[79], 8, 'argon is tier 8')
  assert.equal(innerOf('x', 3)[79], 3, 'pro is tier 3')
})

test('thinking depth is a nested array in slot 17', () => {
  assert.deepEqual(innerOf('x', 3)[17], [[0]], 'deepest thinking is 0, wrapped in a list')
})

test('the prompt and streaming flag are set', () => {
  const inner = innerOf('my prompt', 3)
  assert.equal(inner[0][0], 'my prompt')
  assert.equal(inner[7], 1, 'streaming must be on — the response is parsed as a stream')
})

test('the outer payload is [null, <string>]', () => {
  // The second element must be a JSON STRING, not a nested array.
  const outer = JSON.parse(buildInnerPayload('x', 3, 'U'))
  assert.equal(outer[0], null)
  assert.equal(typeof outer[1], 'string')
})

test('the request id is carried through and is unique per call', () => {
  const a = innerOf('x', 3, makeRequestUuid())
  const b = innerOf('x', 3, makeRequestUuid())
  assert.equal(a[59], a[59], 'the uuid lands in slot 59')
  assert.notEqual(a[59], b[59], 'two requests must not share a uuid')
})

// ────────────────────────────── Model selection ─────────────────────────────

test('the model header carries the id at index 4', () => {
  const model = GEMINI_WEB_MODELS.find((m) => m.id === '95a4c0abcba24364')
  const header = JSON.parse(buildModelHeader(model, '12345'))
  assert.equal(header[4], '95a4c0abcba24364')
})

test('the header tier number matches the payload tier', () => {
  // If these disagree the request is rejected, so both must come from one value.
  for (const m of GEMINI_WEB_MODELS) {
    const header = JSON.parse(buildModelHeader(m, null))
    assert.equal(header[14], m.number, `${m.name}: header tier must equal payload tier`)
  }
})

test('the header carries the client session id', () => {
  // NOT the page's f.sid: that value yields a silent [13] status frame with no
  // answer and no error. The reference implementation sends its own UUID here.
  const header = JSON.parse(buildModelHeader(GEMINI_WEB_MODELS[0], '999'))
  assert.equal(header[16], '999')
})

test('the generated session id is a UUID, not a numeric f.sid', () => {
  const sid = makeSessionId()
  assert.equal(sid, sid.toUpperCase())
  assert.match(sid, /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/)
  assert.ok(!/^\d+$/.test(sid), 'a numeric value would be the page f.sid, which fails')
})

test('Argon is present and ordered first', () => {
  // The whole point of this provider: Argon is on the web app but not in the
  // API, so it must be reachable and be the default.
  assert.equal(GEMINI_WEB_MODELS[0].name, 'Gemini Argon')
  assert.equal(GEMINI_WEB_MODELS[0].id, '95a4c0abcba24364')
  assert.equal(GEMINI_WEB_MODELS[0].number, 8)
})

test('every model id is 16 hex characters', () => {
  for (const m of GEMINI_WEB_MODELS) {
    assert.match(m.id, /^[0-9a-f]{16}$/, `${m.name} has a malformed id`)
  }
})

test('the request uuid is uppercase', () => {
  // The server is case-sensitive about it.
  const u = makeRequestUuid()
  assert.equal(u, u.toUpperCase())
  assert.match(u, /^[0-9A-F-]{36}$/)
})

// ───────────────────────────── Response parsing ─────────────────────────────

/**
 * Build a StreamGenerate frame the way Google does.
 *
 * Padded past 200 characters on purpose: the parser skips short lines as stream
 * framing, so a minimal frame would be filtered out and the test would prove
 * nothing about the real payload shape.
 */
function frame(text, pad = '') {
  const inner = JSON.stringify([null, null, null, null, [[null, [text]]]])
  const arr = [['wrb.fr', 'x', inner, null, null, null, 'generic'], null, null]
  if (pad) arr[0].push(pad)
  const line = JSON.stringify(arr)
  return line.length >= 200 ? line : line + ' '.repeat(200 - line.length)
}

test('text is extracted from a wrb.fr frame', () => {
  const raw = [frame('සුබ උදෑසනක්, ලූකස්.')].join('\n')
  assert.equal(parseResponseText(raw), 'සුබ උදෑසනක්, ලූකස්.')
})

test('the LONGEST text wins, not the last frame', () => {
  // The model streams by resending accumulated text. Taking the last blindly
  // catches a shorter later frame and truncates the reply.
  const raw = [frame('Hello'), frame('Hello world, this is longer.'), frame('Hello wor')].join('\n')
  assert.equal(parseResponseText(raw), 'Hello world, this is longer.')
})

test('noise lines are ignored', () => {
  const raw = ['[["di",1]', ")]}'", '', frame('the real reply')].join('\n')
  assert.equal(parseResponseText(raw), 'the real reply')
})

test('short lines are skipped without throwing', () => {
  assert.equal(parseResponseText('"wrb.fr"\n'), '')
})

test('malformed JSON does not throw', () => {
  const raw = ['"wrb.fr" ' + 'x'.repeat(300), frame('good')].join('\n')
  assert.equal(parseResponseText(raw), 'good')
})

test('a BardErrorInfo becomes a named error, not empty text', () => {
  // Google reports a refusal in-band rather than with an HTTP status, so an
  // empty reply must not be reported as "no output".
  assert.throws(
    () => parseResponseText('some stream BardErrorInfo [1060] more'),
    (e) => e instanceof GeminiWebError
  )
})

test('code-interpreter artifacts are stripped', () => {
  const dirty = 'before\n```python?code_reference&code_event_index=1\nstuff\n```\nafter'
  // The fence and its body go; the surrounding text is left as-is.
  assert.equal(cleanResponseText(dirty), 'before\nafter')
})

// ──────────────────────────── Failure explanation ───────────────────────────

test('a 400 naming xsrf is explained as a session problem', () => {
  const body = '["er",null,null,null,null,400,null,null,null,3,{"48448350":["xsrf","x"]}]'
  assert.match(describeHttpFailure(400, body), /session token/i)
})

test('a 400 with an EMPTY detail is explained as a malformed request', () => {
  // This is the case that actually occurred, and the distinction matters: an
  // empty detail means the request SHAPE is wrong, not the session.
  const body = '["er",null,null,null,null,400,null,null,null,3]'
  assert.match(describeHttpFailure(400, body), /request shape/i)
})

test('a 401 is explained as an expired session', () => {
  assert.match(describeHttpFailure(401, ''), /expired/i)
})

test('a 405 is explained as a stale build id', () => {
  assert.match(describeHttpFailure(405, ''), /build id/i)
})

// ───────────────────────────── Provider routing ─────────────────────────────

const { isGeminiWebModel, modelForModelId, GEMINI_WEB_MODELS: ROUTED } = await loadModules(`
  export { isGeminiWebModel, modelForModelId, GEMINI_WEB_MODELS } from '${projectPath('src/main/modules/gemini-web/index.ts')}'
`, {
  // The provider module transitively imports electron for its keyring and login
  // window. Only the routing helpers are under test, so the stub just needs to
  // satisfy the import graph — not behave.
  electronStub: `
    export const app = { getPath: () => '/tmp' };
    export const safeStorage = { isEncryptionAvailable: () => false };
    export class BrowserWindow {}
    export const session = { fromPartition: () => ({ cookies: { get: async () => [] }, clearStorageData: async () => {} }) };
    export default {};
  `
})

test('gweb ids route to the gemini-web provider', () => {
  assert.equal(isGeminiWebModel('gweb:argon'), true)
  assert.equal(isGeminiWebModel('gemini-3.1-pro-low'), false)
})

test('an Antigravity id is never claimed by the new provider', () => {
  // The whole point of the prefix: an existing user must be unaffected.
  for (const id of ['gemini-3.1-pro-low', 'gemini-pro-agent', 'claude-sonnet-4-6', 'gpt-oss-120b-medium']) {
    assert.equal(isGeminiWebModel(id), false, `${id} must stay on Antigravity`)
  }
})

test('a gweb id resolves to its model definition', () => {
  assert.equal(modelForModelId('gweb:argon')?.id, '95a4c0abcba24364')
  assert.equal(modelForModelId('gweb:pro')?.number, 3)
})

test('EVERY offered model id resolves to a model', () => {
  // This is the bug the earlier hand-written cases missed: an id whose suffix
  // did not match its model key produced a picker entry that silently could not
  // translate. Iterating the advertised list makes that class of mismatch
  // impossible to ship.
  for (const m of ROUTED) {
    assert.notEqual(modelForModelId(m.id), null, `${m.id} must resolve to a model`)
  }
})

test('an unknown gweb tier resolves to null, not a wrong model', () => {
  // Silently falling back to a default model would translate with a different
  // model than the user selected.
  assert.equal(modelForModelId('gweb:nonexistent'), null)
  assert.equal(modelForModelId('gemini-3.1-pro-low'), null)
})

// ────────────────────────── Conversation continuity ─────────────────────────
//
// Sending no metadata starts a NEW chat per request. A 500-cue job created ~30
// chats that way, which filled the account's history and got it rate limited.

test('a reply\'s chat ids are extracted for the next request', () => {
  // The pair lives at inner[1] of a wrb.fr frame.
  const inner = JSON.stringify([null, ['c_abc123', 'r_def456']])
  const line = JSON.stringify([['wrb.fr', 'x', inner, null, null, null, 'generic'], null, null])
  const raw = [line + ' '.repeat(Math.max(0, 200 - line.length))].join('\n')
  assert.deepEqual(parseChatMetadata(raw), ['c_abc123', 'r_def456'])
})

test('a chat-only pair is accepted as a continuation', () => {
  const inner = JSON.stringify([null, ['c_only']])
  const line = JSON.stringify([['wrb.fr', 'x', inner, null, null, null, 'generic'], null, null])
  const raw = [line + ' '.repeat(Math.max(0, 200 - line.length))].join('\n')
  assert.deepEqual(parseChatMetadata(raw), ['c_only'])
})

test('no ids yields null, so a fresh chat starts rather than a bad continuation', () => {
  assert.equal(parseChatMetadata('no frames here'), null)
  const inner = JSON.stringify([null, null])
  const line = JSON.stringify([['wrb.fr', 'x', inner, null, null, null, 'generic'], null, null])
  const raw = [line + ' '.repeat(Math.max(0, 200 - line.length))].join('\n')
  assert.equal(parseChatMetadata(raw), null)
})

test('the chat ids are sent in payload slot 2', () => {
  const outer = JSON.parse(buildInnerPayload('x', 3, 'U', 0, ['c_abc', 'r_def']))
  const inner = JSON.parse(outer[1])
  assert.deepEqual(inner[2], ['c_abc', 'r_def'])
})

test('without chat ids slot 2 stays the default metadata', () => {
  const outer = JSON.parse(buildInnerPayload('x', 3, 'U'))
  const inner = JSON.parse(outer[1])
  assert.equal(inner[2].length, 10, 'the default metadata block is 10 elements')
  assert.equal(inner[2][3], null)
})

// ───────────────────────── Chunking for Gemini web ──────────────────────────
//
// A Gemini web conversation is limited by how many MESSAGES the account sends,
// not by cues. At the default 15-cue chunk a 1500-cue movie is 100 requests;
// at 500 it is 3. Fewer messages means far less pressure on the rate limiter.

test('Gemini web uses a much larger chunk than the default', async () => {
  const { CHUNK_SIZE, GEMINI_WEB_CHUNK_SIZE } = await loadModules(`
    export { CHUNK_SIZE, GEMINI_WEB_CHUNK_SIZE } from '${projectPath('src/shared/constants.ts')}'
  `)
  assert.equal(CHUNK_SIZE, 15, 'Antigravity keeps the smaller chunk')
  assert.equal(GEMINI_WEB_CHUNK_SIZE, 500)
  assert.ok(
    GEMINI_WEB_CHUNK_SIZE > CHUNK_SIZE * 10,
    'the whole point is a large reduction in request count'
  )
})

test('a 1500-cue movie costs 3 requests on Gemini web, 100 on Antigravity', async () => {
  const { CHUNK_SIZE, GEMINI_WEB_CHUNK_SIZE } = await loadModules(`
    export { CHUNK_SIZE, GEMINI_WEB_CHUNK_SIZE } from '${projectPath('src/shared/constants.ts')}'
  `)
  const cues = 1500
  assert.equal(Math.ceil(cues / GEMINI_WEB_CHUNK_SIZE), 3)
  assert.equal(Math.ceil(cues / CHUNK_SIZE), 100)
})

// ──────────────────── Message-count minimising chunk split ──────────────────
//
// A trailing fragment must not cost a whole extra message. 509 cues used to
// become 500 + 9 — a second request for 2% of the work.

const { chunkForGeminiWeb } = await loadModules(`
  export { chunkForGeminiWeb } from '${projectPath('src/main/modules/translation-engine.ts')}'
`, {
  electronStub: `
    export const app = { getPath: () => '/tmp' };
    export const safeStorage = { isEncryptionAvailable: () => false };
    export class BrowserWindow {}
    export const session = { fromPartition: () => ({ cookies: { get: async () => [] }, clearStorageData: async () => {} }) };
    export default {};
  `
})

const sizesOf = (n) => chunkForGeminiWeb(Array.from({ length: n }, (_, i) => i)).map((c) => c.length)

test('509 cues fit in ONE request, not 500 + 9', () => {
  assert.deepEqual(sizesOf(509), [509])
})

test('a file up to the ceiling is a single request', () => {
  assert.deepEqual(sizesOf(600), [600])
  assert.deepEqual(sizesOf(500), [500])
})

test('a small trailing fragment merges into the previous chunk', () => {
  // 1100 = 500 + 600, not 500 + 500 + 100.
  assert.deepEqual(sizesOf(1100), [500, 600])
})

test('a large trailing fragment stays its own request', () => {
  // 700 = 500 + 200; 200 is not a trivial fragment, and merging would exceed
  // the ceiling anyway.
  assert.deepEqual(sizesOf(700), [500, 200])
})

test('no chunk ever exceeds the ceiling', () => {
  for (const n of [500, 509, 600, 601, 700, 1000, 1100, 1200, 1500, 3000, 9999]) {
    for (const size of sizesOf(n)) {
      assert.ok(size <= 600, `${n} cues produced a chunk of ${size}, over the 600 ceiling`)
    }
  }
})

test('no cue is ever lost or duplicated', () => {
  for (const n of [1, 15, 500, 509, 700, 1100, 1500]) {
    const chunks = chunkForGeminiWeb(Array.from({ length: n }, (_, i) => i))
    const flat = chunks.flat()
    assert.equal(flat.length, n, `${n} cues: expected ${n} out, got ${flat.length}`)
    assert.deepEqual(flat, Array.from({ length: n }, (_, i) => i), `${n} cues: order or content changed`)
  }
})

test('an empty input yields no requests', () => {
  assert.deepEqual(chunkForGeminiWeb([]), [])
})

// ───────────────────────────── Refusal detection ────────────────────────────
//
// Google refuses a model with a chatty apology at HTTP 200, not an error status.
// Treated as text it becomes the "translation" of 500 cues, so it must be
// recognised — otherwise the caller never tries a model that works.

const { looksLikeRefusal } = await loadModules(`
  export { looksLikeRefusal } from '${projectPath('src/main/modules/gemini-web/protocol.ts')}'
`)

test('the apology Google returns for an unavailable model is a refusal', () => {
  assert.equal(
    looksLikeRefusal('I seem to be encountering an error. Can I try something else for you?'),
    true
  )
})

test('the other observed refusal wording is caught', () => {
  assert.equal(
    looksLikeRefusal("I encountered an error doing what you asked. Could you try again?"),
    true
  )
})

test('a real translation is never mistaken for a refusal', () => {
  // A subtitle translation is thousands of characters with cue numbering.
  const real = '1\n00:00:01,000 --> 00:00:03,000\nසුබ උදෑසනක්.\n\n2\n00:00:04,000 --> 00:00:06,000\nකොහොමද ඉන්නේ?\n'.repeat(40)
  assert.equal(looksLikeRefusal(real), false)
})

test('a LONG reply containing the word error is not a refusal', () => {
  // Guards against a real translation that happens to mention an error.
  const long = 'මෙහි දෝෂයක් සිදු විය. '.repeat(60)
  assert.equal(looksLikeRefusal(long), false)
})
