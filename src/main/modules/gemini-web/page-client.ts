import { BrowserWindow, session as electronSession } from 'electron'
import {
  GEMINI_ORIGIN,
  GEMINI_WEB_MODELS,
  GeminiWebError,
  THINK_DEEPEST,
  buildInnerPayload,
  buildModelHeader,
  cleanResponseText,
  describeHttpFailure,
  makeRequestUuid,
  makeSessionId,
  parseChatMetadata,
  parseResponseText,
  type GeminiWebModel
} from './protocol'

/**
 * Send generation requests FROM INSIDE the gemini.google.com page.
 *
 * WHY THE REQUEST RUNS IN THE PAGE, not from the main process:
 *
 * A hand-written request from the main process returned HTTP 400 error-3 for
 * twelve rounds. Running the same request in the page's own JavaScript fixed it,
 * because that removes three problems at once:
 *
 *   1. COOKIES. Electron's global `fetch` silently strips the `Cookie` header
 *      (forbidden per the Fetch spec) and `net.fetch` will not attach session
 *      cookies unless asked. A same-origin fetch needs neither workaround —
 *      Chromium attaches them itself.
 *   2. TLS FINGERPRINT. The request carries Chromium's real Chrome fingerprint
 *      rather than Node/undici's, which Google's edge treats differently.
 *   3. LIVE TOKENS. `at` (SNlM0e) and `f.sid` (FdrFJe) are read from the page's
 *      live globals at the moment of use. They bind to the current
 *      __Secure-1PSIDTS, which rotates, so a cached copy goes stale and is
 *      rejected.
 *
 * The payload shape is the other half of the fix and lives in protocol.ts. Both
 * halves are required: a correct payload sent without cookies fails, and correct
 * cookies carrying a malformed payload fail.
 *
 * The page is kept alive between chunks, so a translation job reuses one warm
 * page instead of reloading per chunk.
 */

const PARTITION = 'persist:gemini-web'
const PAGE_SETTLE_MS = 4000

let worker: BrowserWindow | null = null

/**
 * This client's session id, sent in the model header.
 *
 * Generated once and reused for the process lifetime, matching the reference
 * implementation. It must be a UUID: sending the page's `f.sid` here makes the
 * server answer with a bare `[13]` status frame and no text.
 */
let clientSessionId = makeSessionId()

/**
 * The conversation the current job is appending to, as `[chatId, replyId]`.
 *
 * Held here rather than threaded through every call site: a translation job
 * makes hundreds of requests, and each one must continue the SAME chat. Sending
 * no metadata starts a new conversation per request, which filled the account's
 * history with hundreds of chats and got it rate limited.
 *
 * Cleared by resetChatSession() when a new job begins.
 */
let lastChatMetadata: string[] | null = null

/** Start a fresh conversation on the next send. Call once per job. */
export function resetChatSession(): void {
  lastChatMetadata = null
}

export class GeminiWebLoginError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GeminiWebLoginError'
    this.code = code
  }
}

/** True when the login partition currently holds a usable session. */
export async function hasGeminiWebSession(): Promise<boolean> {
  try {
    const ses = electronSession.fromPartition(PARTITION)
    const all = await ses.cookies.get({})
    const have = new Set(all.map((c) => c.name))
    return have.has('__Secure-1PSID') && have.has('__Secure-1PSIDTS')
  } catch {
    return false
  }
}

/** Drop the stored cookies for the login partition. */
export async function logoutGeminiWeb(): Promise<void> {
  await closeWorker()
  const ses = electronSession.fromPartition(PARTITION)
  await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {})
}

/** Close the hidden worker page, if one is open. */
export async function closeWorker(): Promise<void> {
  if (worker && !worker.isDestroyed()) {
    try {
      worker.destroy()
    } catch {
      // Already gone.
    }
  }
  worker = null
}

/**
 * The hidden page that performs requests, created on demand.
 *
 * Hidden rather than shown: it exists to hold a session, and the user already
 * has the app's own window. `show: false` keeps it out of the window list and
 * the taskbar.
 */
async function getWorker(): Promise<BrowserWindow> {
  if (worker && !worker.isDestroyed()) return worker

  worker = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      partition: PARTITION,
      // Google's page must never reach Node or a preload.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  worker.on('closed', () => {
    worker = null
  })

  await worker.loadURL(`${GEMINI_ORIGIN}/app`)
  // The page's globals appear asynchronously after load; reading them too early
  // reports a signed-out page that is actually fine.
  await new Promise((r) => setTimeout(r, PAGE_SETTLE_MS))
  return worker
}

interface PageState {
  at: boolean
  sid: string | null
  bl: string | null
}

/** Read the page's live tokens. Absence of `at` means the session is dead. */
async function readPageState(win: BrowserWindow): Promise<PageState> {
  return (await win.webContents.executeJavaScript(
    `(function () {
       var g = window.WIZ_global_data || {};
       return { at: !!g.SNlM0e, sid: g.FdrFJe || null, bl: g.cfb2h || null };
     })()`,
    true
  )) as PageState
}

async function ensureReady(win: BrowserWindow): Promise<PageState> {
  const st = await readPageState(win)
  if (!st.at) {
    throw new GeminiWebError(
      'The Gemini session has expired. Sign in again from Advanced → Gemini web.',
      'session_expired'
    )
  }
  return st
}

export interface PageSendOptions {
  prompt: string
  /** Numeric model tier for payload slot [79]. */
  mode: number
  /** The 16-hex model id for the model header. */
  modelId?: string
  /**
   * Continue this conversation instead of starting a new one, as
   * `[chatId, replyId]`. Omitted for the first chunk of a job.
   */
  chatMetadata?: string[] | null
  signal?: AbortSignal
}

/**
 * Send one prompt through the live page and return the reply text.
 *
 * The request is built in the page's own JavaScript so that:
 *  - `f.req` is assembled with the page's CURRENT tokens, never a cached copy;
 *  - the fetch is same-origin, so Chromium supplies the cookies and the TLS
 *    fingerprint without any header handling here;
 *  - a 405 (stale build id) or a 400 naming xsrf is retried once after a page
 *    reload, which re-scrapes both.
 *
 * Values travel into the page through a global rather than string
 * interpolation, so no amount of quoting in the prompt can break the script.
 */
export async function sendViaPage(opts: PageSendOptions): Promise<string> {
  const win = await getWorker()
  const st = await ensureReady(win)

  const uuid = makeRequestUuid()
  // Passing the previous reply's [chatId, replyId] appends to the SAME chat.
  // Without it every chunk opens a new conversation — a 500-cue job created ~30
  // chats, which is what got the account rate limited.
  const fReq = buildInnerPayload(opts.prompt, opts.mode, uuid, THINK_DEEPEST, opts.chatMetadata)

  const model: GeminiWebModel | undefined = GEMINI_WEB_MODELS.find(
    (m) => m.id === opts.modelId
  )
  // The header's trailing value is the CLIENT's own session id, not the page's
  // f.sid — passing the page value yields a silent [13] status frame instead of
  // an answer. It is stable for the life of the worker page.
  const modelHeader = model ? buildModelHeader(model, clientSessionId) : null

  const args = { uuid, fReq, modelHeader }

  const result = (await win.webContents.executeJavaScript(
    `window.__GW_ARGS = ${JSON.stringify(args)};
     (async function () {
       var g = window.WIZ_global_data || {};
       var at = g.SNlM0e, sid = g.FdrFJe, bl = g.cfb2h;
       if (!at) return { error: 'no_at' };

       var a = window.__GW_ARGS;
       var url = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'
         + '?hl=en&_reqid=' + (Math.floor(Math.random() * 900000) + 100000) + '&rt=c';
       if (bl) url += '&bl=' + encodeURIComponent(bl);
       if (sid) url += '&f.sid=' + encodeURIComponent(sid);

       var headers = {
         'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
         'X-Same-Domain': '1',
         'x-goog-ext-525005358-jspb': JSON.stringify([a.uuid, 1])
       };
       if (a.modelHeader) {
         headers['x-goog-ext-525001261-jspb'] = a.modelHeader;
         headers['x-goog-ext-73010989-jspb'] = '[0]';
         headers['x-goog-ext-73010990-jspb'] = '[0,0,0]';
       }

       try {
         // at FIRST, then f.req — the order the working client sends.
         var body = 'at=' + encodeURIComponent(at) + '&f.req=' + encodeURIComponent(a.fReq);
         var res = await fetch(url, {
           method: 'POST', headers: headers, body: body, credentials: 'include'
         });

         if (!res.ok) {
           var errText = await res.text();
           return { status: res.status, text: errText };
         }

         // READ THE STREAM INCREMENTALLY.
         //
         // StreamGenerate holds the connection open after the reply is sent, so
         // awaiting res.text() can block until Google closes it. Reading chunks
         // and stopping at done returns as soon as the stream ends — measured
         // at ~2.5s for a full 17KB reply.
         //
         // The quiet timer is a SAFETY NET, not the exit condition. It must be
         // generous: the first frame to arrive is a small session frame carrying
         // no answer text, so breaking shortly after it would discard the reply
         // entirely and report an empty response.
         var reader = res.body.getReader();
         var dec = new TextDecoder();
         var acc = '';
         var t0 = Date.now();
         var QUIET_MS = 20000;   // safety net only; done normally fires first
         var FIRST_MS = 60000;   // no data at all this long => dead stream
         var truncated = false;

         while (true) {
           var step;
           try {
             step = await Promise.race([
               reader.read().then(function (r) { return { kind: 'data', r: r }; }),
               new Promise(function (resolve) {
                 setTimeout(function () { resolve({ kind: 'idle' }); }, QUIET_MS);
               })
             ]);
           } catch (readErr) {
             // The connection dropped mid-stream. Whatever arrived is INCOMPLETE,
             // and a partial translation returned as success would export a file
             // with untranslated gaps and no error. Report it so the caller
             // retries the chunk instead.
             return { status: 200, text: acc, truncated: true, error: String(readErr) };
           }

           if (step.kind === 'idle') { truncated = true; break; }   // stalled
           if (step.r.done) break;                                  // stream ended cleanly
           acc += dec.decode(step.r.value, { stream: true });
           if (Date.now() - t0 > FIRST_MS) { truncated = true; break; }
         }

         try { await reader.cancel(); } catch (e) { /* already closed */ }
         return { status: 200, text: acc, truncated: truncated };
       } catch (e) {
         return { error: String(e) };
       }
     })()`,
    true
  )) as { status?: number; text?: string; error?: string; truncated?: boolean }

  if (result.error && !result.truncated) {
    throw new GeminiWebError(
      `The Gemini page could not complete the request: ${result.error}`,
      'page_error'
    )
  }

  const raw = result.text ?? ''

  // A stream that stalled or dropped mid-flight carries only part of the reply.
  // Returning it as success would export a file with untranslated gaps and no
  // error, so it is reported as a failure and the caller retries the chunk.
  if (result.truncated) {
    throw new GeminiWebError(
      'The reply stream was interrupted before it finished. Retrying this chunk.',
      'stream_truncated'
    )
  }

  if (result.status && result.status !== 200) {
    // A stale build id or a rotated token is recoverable by reloading the page,
    // which re-scrapes both. One retry, then report.
    if (result.status === 405 || (result.status === 400 && /xsrf/i.test(raw))) {
      await win.reload()
      await new Promise((r) => setTimeout(r, PAGE_SETTLE_MS))
      await ensureReady(win)
      return sendViaPage(opts)
    }
    throw new GeminiWebError(describeHttpFailure(result.status, raw), `http_${result.status}`)
  }

  const text = cleanResponseText(parseResponseText(raw))
  if (!text) {
    // A `[13]` frame is a silent model rejection: HTTP 200, no error, no text.
    // It appears when the model header is malformed or the model is not offered
    // to this account, so it is worth naming rather than reporting as empty.
    const isModelStatus = /\[13\]/.test(raw)
    throw new GeminiWebError(
      isModelStatus
        ? `Gemini refused this model for the account (status 13). ${opts.modelId ? `"${opts.modelId}" may not be available — check model availability in Advanced.` : ''}`
        : 'Gemini returned an empty reply. The session may have expired, or this model may not be available on the account.',
      isModelStatus ? 'model_refused' : 'empty_reply'
    )
  }

  // The reply carries the conversation's ids. Handing them back on the next call
  // keeps the whole job in one chat instead of creating one per chunk.
  //
  // Captured BEFORE the text is returned, and only on a complete reply: a
  // truncated response may carry a reply id whose turn never finished, and
  // continuing from it would leave the model's context holding a half-answer.
  lastChatMetadata = parseChatMetadata(raw) ?? lastChatMetadata

  return text
}

/** One probe result, for the Advanced panel's availability check. */
export interface GeminiWebProbeEntry {
  name: string
  mode: number
  ok: boolean
  error?: string
}

/**
 * Ask Google which models this account can actually reach.
 *
 * Exposed to the UI because the model behind a tier is chosen server-side, so
 * the only truthful answer to "do I have Argon?" is to try it. Probed
 * sequentially: the calls are cheap, but parallel requests against one session
 * risk rate limiting, which would read as "unavailable" and send the user
 * chasing a problem that is not there.
 */
export async function probeGeminiWebModels(): Promise<GeminiWebProbeEntry[]> {
  const out: GeminiWebProbeEntry[] = []
  for (const m of GEMINI_WEB_MODELS) {
    try {
      await sendViaPage({ prompt: 'Reply with exactly: OK', mode: m.number, modelId: m.id })
      out.push({ name: m.name, mode: m.number, ok: true })
    } catch (err) {
      out.push({
        name: m.name,
        mode: m.number,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err)
      })
    }
  }
  return out
}

export { PARTITION as GEMINI_WEB_PARTITION }
