import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModules, projectPath } from './helpers/load-module.mjs'

const {
  buildInnerPayload,
  buildModelHeader,
  makeRequestUuid,
  makeSessionId,
  parseResponseText,
  cleanResponseText,
  describeHttpFailure,
  GEMINI_WEB_MODELS,
  GeminiWebError
} = await loadModules(`
  export {
    buildInnerPayload, buildModelHeader, makeRequestUuid, makeSessionId, parseResponseText,
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
