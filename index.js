"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const promises = require("fs/promises");
const crypto = require("crypto");
const http = require("http");
const CHUNK_SIZE = 15;
const CONCURRENCY = 6;
const TRANSLATION_PROMPT = `Translate the following subtitle into natural spoken Sri Lankan Sinhala. Preserve the meaning, tone, and emotion. Do not censor profanity. Preserve the original subtitle numbers exactly as shown. Return only the translated subtitle in the same SRT format.`;
const IPC_CHANNELS = {
  // Antigravity account auth
  AUTH_BEGIN: "auth-begin",
  AUTH_CANCEL: "auth-cancel",
  AUTH_STATUS: "auth-status",
  AUTH_LOGOUT: "auth-logout",
  AUTH_CAN_PERSIST: "auth-can-persist",
  AUTH_PROGRESS: "auth-progress",
  AUTH_STATE_CHANGED: "auth-state-changed",
  // Account data
  QUOTA_GET: "quota-get",
  QUOTA_REFRESH: "quota-refresh",
  LIST_MODELS: "list-models",
  // Files
  IMPORT_SRT: "import-srt",
  IMPORT_SRT_PATH: "import-srt-path",
  EXPORT_SRT: "export-srt",
  SELECT_MKV: "select-mkv",
  LIST_MKV_TRACKS: "list-mkv-tracks",
  EXTRACT_MKV_TRACK: "extract-mkv-track",
  // Translation
  START_TRANSLATION: "start-translation",
  CANCEL_TRANSLATION: "cancel-translation",
  TRANSLATION_PROGRESS: "translation-progress",
  TRANSLATION_COMPLETE: "translation-complete"
};
async function importSrtFile() {
  const result = await electron.dialog.showOpenDialog({
    filters: [{ name: "SRT Subtitles", extensions: ["srt"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await promises.readFile(filePath, "utf-8");
  return { filePath, fileName: path.basename(filePath), content };
}
async function selectMkvFile() {
  const result = await electron.dialog.showOpenDialog({
    filters: [{ name: "MKV/Matroska Movies", extensions: ["mkv"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}
async function exportSrtFile(content, suggestedName) {
  const result = await electron.dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters: [{ name: "SRT Subtitles", extensions: ["srt"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await promises.writeFile(result.filePath, content, "utf-8");
  return result.filePath;
}
function parseSrt(content) {
  let text = content.replace(/^\uFEFF/, "");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const entries = [];
  const timestampRegex = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;
  const rawBlocks = text.split(/\n{2,}/);
  const blocks = [];
  for (const raw of rawBlocks) {
    if (!raw.trim()) continue;
    const startsNewCue = (() => {
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return false;
      if (/^\d+\.?$/.test(lines[0]) && lines[1] && timestampRegex.test(lines[1])) return true;
      return timestampRegex.test(lines[0]);
    })();
    if (startsNewCue || blocks.length === 0) {
      blocks.push(raw);
    } else {
      blocks[blocks.length - 1] += "\n\n" + raw;
    }
  }
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    let timestampLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (timestampRegex.test(lines[i])) {
        timestampLineIndex = i;
        break;
      }
    }
    if (timestampLineIndex === -1) continue;
    const match = lines[timestampLineIndex].match(timestampRegex);
    if (!match) continue;
    const textLines = lines.slice(timestampLineIndex + 1);
    while (textLines.length && !textLines[0].trim()) textLines.shift();
    while (textLines.length && !textLines[textLines.length - 1].trim()) textLines.pop();
    if (textLines.length === 0) continue;
    const idLine = timestampLineIndex > 0 ? lines[timestampLineIndex - 1].trim() : "";
    entries.push({
      id: idLine.replace(/\.$/, "") || String(entries.length + 1),
      startTime: match[1],
      endTime: match[2],
      text: textLines.join("\n")
    });
  }
  return entries;
}
function serializeSrt(entries) {
  return entries.map((e, i) => `${i + 1}
${e.startTime} --> ${e.endTime}
${e.text}`).join("\n\n") + "\n";
}
function cleanAiResponse(response) {
  const fenceMatch = response.match(/```(?:srt)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return response.trim();
}
function buildMessages(chunk) {
  const srtBlock = chunk.subtitles.map((s) => `${s.id}
${s.startTime} --> ${s.endTime}
${s.text}`).join("\n\n");
  return [
    { role: "system", content: TRANSLATION_PROMPT },
    { role: "user", content: srtBlock }
  ];
}
const ANTIGRAVITY_OAUTH = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
  // No "openid" scope: requesting it with this client routed Google into the
  // hanging firstparty/nativeapp consent screen. These five scopes are what the
  // official Antigravity client requests.
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs"
  ],
  // Loopback redirect for installed-app OAuth. Google allows any localhost port.
  callbackPath: "/oauth-callback"
};
const ANTIGRAVITY_BOOTSTRAP_BASE_URLS = Object.freeze([
  "https://cloudcode-pa.googleapis.com"
]);
const ANTIGRAVITY_RUNTIME_BASE_URLS = Object.freeze([
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com"
]);
const ANTIGRAVITY_DISCOVERY_BASE_URLS = Object.freeze([
  ...ANTIGRAVITY_RUNTIME_BASE_URLS,
  "https://daily-cloudcode-pa.sandbox.googleapis.com"
]);
const ANTIGRAVITY_API_VERSION = "v1internal";
const ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS = Object.freeze(
  ANTIGRAVITY_BOOTSTRAP_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`
  )
);
const ANTIGRAVITY_ONBOARD_USER_ENDPOINTS = Object.freeze(
  ANTIGRAVITY_BOOTSTRAP_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:onboardUser`
  )
);
const ANTIGRAVITY_FETCH_AVAILABLE_MODELS_URLS = Object.freeze(
  ANTIGRAVITY_DISCOVERY_BASE_URLS.map(
    (base) => `${base}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`
  )
);
const ANTIGRAVITY_QUOTA_CACHE_TTL_MS = 60 * 1e3;
const ANTIGRAVITY_OS_TYPE = "darwin";
const ANTIGRAVITY_ARCH = "arm64";
const ANTIGRAVITY_IDE_VERSION = "2.1.1";
const ANTIGRAVITY_ENVELOPE_USER_AGENT = "antigravity";
function antigravityIdeUserAgent(version = ANTIGRAVITY_IDE_VERSION) {
  return `antigravity/ide/${version} ${ANTIGRAVITY_OS_TYPE}/${ANTIGRAVITY_ARCH}`;
}
function getAntigravityContentHeaders(accessToken) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": antigravityIdeUserAgent()
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}
function getAntigravityLoadCodeAssistMetadata() {
  return { ideType: "ANTIGRAVITY" };
}
const ANTIGRAVITY_PUBLIC_MODELS = Object.freeze([
  { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "gemini-3.7-flash-tiered", name: "Gemini 3.7 Flash (Tiered)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", contextLength: 1048576, maxOutputTokens: 65535 },
  { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", contextLength: 1048576, maxOutputTokens: 65535 },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", contextLength: 1048576, maxOutputTokens: 65535 },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", contextLength: 1048576, maxOutputTokens: 65536 },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", contextLength: 131072, maxOutputTokens: 32768 }
]);
const MODEL_NAME_MAP = Object.fromEntries(
  ANTIGRAVITY_PUBLIC_MODELS.map((m) => [m.id, m.name])
);
const ANTIGRAVITY_MODEL_ALIASES = {
  "gemini-3.7-flash": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gpt-oss-120b": "gpt-oss-120b-medium",
  // gemini-3.1-pro-low is accepted verbatim upstream (no alias).
  "gemini-3.1-pro-high": "gemini-pro-agent",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-claude-sonnet-4-5": "claude-sonnet-4-6",
  "gemini-claude-sonnet-4-5-thinking": "claude-sonnet-4-6",
  "gemini-claude-opus-4-5-thinking": "claude-opus-4-6-thinking"
};
const ANTIGRAVITY_PRO_FALLBACK_CHAINS = {
  "gemini-3.1-pro-low": ["gemini-3.1-pro-low", "gemini-3-pro-low"]
};
const ANTIGRAVITY_DROPPED_MODEL_IDS = /* @__PURE__ */ new Set([
  "gemini-3-pro-preview",
  "gemini-3.1-pro",
  "gemini-2.5-pro",
  "gemini-2.5-flash-thinking",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-preview"
]);
const NON_CHAT_PATTERN = /(?:^|[-_])(image|imagen|audio|tts|embedding|embed|video|veo)(?:[-_]|$)/i;
function resolveAntigravityModelId(modelId) {
  if (!modelId) return modelId;
  return ANTIGRAVITY_MODEL_ALIASES[modelId] || modelId;
}
function getAntigravityModelName(id, fallback) {
  return MODEL_NAME_MAP[id] || fallback || id;
}
function getAntigravityModelFallbacks(modelId) {
  return ANTIGRAVITY_PRO_FALLBACK_CHAINS[modelId] ?? [];
}
function isDiscoverableAntigravityModelId(modelId) {
  const id = (modelId || "").trim();
  if (!id || ANTIGRAVITY_DROPPED_MODEL_IDS.has(id)) return false;
  return !NON_CHAT_PATTERN.test(id);
}
function pickChatModels(ids) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of ids) {
    const id = resolveAntigravityModelId(String(raw || "").trim());
    if (!id || seen.has(id) || !isDiscoverableAntigravityModelId(id)) continue;
    seen.add(id);
    out.push({ id, name: getAntigravityModelName(id), ...MODEL_META[id] ?? {} });
  }
  return out;
}
const MODEL_META = Object.fromEntries(
  ANTIGRAVITY_PUBLIC_MODELS.map((m) => [
    m.id,
    { contextLength: m.contextLength, maxOutputTokens: m.maxOutputTokens }
  ])
);
class OAuthError extends Error {
  code;
  constructor(message, code = "oauth_error") {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}
function generateOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}
function buildAuthUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_OAUTH.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_OAUTH.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent"
  });
  return `${ANTIGRAVITY_OAUTH.authorizeUrl}?${params.toString()}`;
}
function startOAuthListener() {
  let server = null;
  let resolveCode = null;
  let rejectCode = null;
  const waitForCode = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const html = (title, body) => `<html><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;background:#0a0a0b;color:#e5e5e5;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#9ca3af">${body}</p></div></body></html>`;
    if (url.pathname !== ANTIGRAVITY_OAUTH.callbackPath) {
      res.writeHead(404).end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (code) {
      res.end(html("Signed in ✓", "You can close this tab and return to SRT Translator."));
      resolveCode?.({ code, state: state ?? "" });
    } else {
      res.end(html("Sign-in failed", "No authorization code was returned. Close this tab and try again."));
      rejectCode?.(new OAuthError("Google did not return an authorization code", "no_code"));
    }
    server?.close();
    server = null;
  });
  server.on("error", (err) => {
    rejectCode?.(err);
  });
  const redirectUriPromise = new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const { port } = server?.address() ?? { port: 0 };
      resolve(`http://127.0.0.1:${port}${ANTIGRAVITY_OAUTH.callbackPath}`);
    });
  });
  const listener = {
    redirectUri: "",
    waitForCode,
    close: () => server?.close()
  };
  void redirectUriPromise.then((uri) => {
    listener.redirectUri = uri;
  });
  return listener;
}
function awaitRedirectUri(listener) {
  return listener.redirectUri ? Promise.resolve(listener.redirectUri) : new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (listener.redirectUri) {
        clearInterval(iv);
        resolve(listener.redirectUri);
      } else if (Date.now() - t0 > 5e3) {
        clearInterval(iv);
        reject(new OAuthError("Could not bind OAuth callback listener", "bind_failed"));
      }
    }, 25);
  });
}
async function postForm(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new OAuthError(
      String(data.error_description || data.error || data.raw || `HTTP ${response.status}`),
      "token_exchange"
    );
  }
  return data;
}
async function exchangeCodeForTokens(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ANTIGRAVITY_OAUTH.clientId,
    client_secret: ANTIGRAVITY_OAUTH.clientSecret,
    code,
    redirect_uri: redirectUri
  });
  const data = await postForm(ANTIGRAVITY_OAUTH.tokenUrl, body);
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new OAuthError("Token response missing access_token", "no_access_token");
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : void 0,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : void 0
  };
}
async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ANTIGRAVITY_OAUTH.clientId,
    client_secret: ANTIGRAVITY_OAUTH.clientSecret,
    refresh_token: refreshToken
  });
  const data = await postForm(ANTIGRAVITY_OAUTH.tokenUrl, body);
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new OAuthError("Refresh failed: no access_token returned", "refresh_failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : void 0
  };
}
async function revokeGoogleToken(token) {
  try {
    await fetch(`${ANTIGRAVITY_OAUTH.revokeUrl}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
  } catch {
  }
}
function sessionFile() {
  const dir = electron.app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "session.bin");
}
function canPersistSession() {
  try {
    return electron.safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
function saveSession(session2) {
  if (!session2.refreshToken) return;
  if (!canPersistSession()) {
    return;
  }
  const payload = {
    refreshToken: session2.refreshToken,
    email: session2.email,
    picture: session2.picture,
    plan: session2.plan,
    projectId: session2.projectId,
    tierId: session2.tierId,
    connectedAt: session2.connectedAt,
    version: 1
  };
  try {
    const encrypted = electron.safeStorage.encryptString(JSON.stringify(payload));
    fs.writeFileSync(sessionFile(), encrypted, { mode: 384 });
  } catch {
  }
}
function loadPersistedSession() {
  if (!canPersistSession()) return null;
  try {
    const raw = fs.readFileSync(sessionFile());
    const data = JSON.parse(electron.safeStorage.decryptString(raw));
    if (data.version !== 1 || typeof data.refreshToken !== "string" || !data.refreshToken) {
      return null;
    }
    return data;
  } catch {
    clearPersistedSession();
    return null;
  }
}
function clearPersistedSession() {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {
  }
}
let session = null;
function getSession() {
  return session;
}
function setSession(data) {
  session = data;
  saveSession(data);
}
function clearSession() {
  session = null;
  clearPersistedSession();
}
function getAccount() {
  if (!session) return null;
  return {
    email: session.email,
    picture: session.picture,
    plan: session.plan,
    projectId: session.projectId,
    tierId: session.tierId,
    connectedAt: session.connectedAt
  };
}
async function restoreSession() {
  if (session) return true;
  const saved = loadPersistedSession();
  if (!saved) return false;
  session = {
    // No access token yet — getAccessToken() refreshes it on first use.
    accessToken: "",
    refreshToken: saved.refreshToken,
    // Force an immediate refresh.
    expiresAt: 0,
    email: saved.email,
    picture: saved.picture,
    plan: saved.plan,
    projectId: saved.projectId,
    tierId: saved.tierId,
    connectedAt: saved.connectedAt
  };
  const token = await getAccessToken();
  if (!token) {
    return false;
  }
  return true;
}
async function getAccessToken() {
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt && now + 5 * 60 * 1e3 >= session.expiresAt) {
    if (!session.refreshToken) return null;
    try {
      const tokens = await refreshAccessToken(session.refreshToken);
      session.accessToken = tokens.accessToken;
      if (tokens.refreshToken) session.refreshToken = tokens.refreshToken;
      if (tokens.expiresIn) session.expiresAt = now + tokens.expiresIn * 1e3;
      saveSession(session);
      return session.accessToken;
    } catch {
      clearSession();
      return null;
    }
  }
  return session.accessToken;
}
async function logout() {
  if (session?.accessToken) {
    await revokeGoogleToken(session.accessToken).catch(() => {
    });
  }
  clearSession();
}
class AntigravityApiError extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "AntigravityApiError";
    this.status = status;
  }
}
class AntigravityModelError extends Error {
  modelId;
  constructor(message, modelId) {
    super(message);
    this.name = "AntigravityModelError";
    this.modelId = modelId;
  }
}
const REQUEST_TIMEOUT_MS = 3e5;
function generateRequestId() {
  return `agent/${Date.now()}/${crypto.randomBytes(4).toString("hex")}`;
}
function generateSessionId() {
  return `-${Math.floor(Math.random() * 9e18)}`;
}
async function sendAntigravityRequest(request) {
  const accessToken = await getAccessToken();
  const session2 = getSession();
  if (!accessToken) {
    throw new AntigravityApiError("Not signed in to Antigravity. Please sign in again.", 401);
  }
  const projectId = session2?.projectId;
  if (!projectId) {
    throw new AntigravityApiError("No Cloud Code project found for this account. Re-sign in.", 403);
  }
  const upstreamModel = resolveAntigravityModelId(request.model);
  const requestId = generateRequestId();
  const sessionId = generateSessionId();
  const contents = request.messages.map((m) => ({
    role: m.role === "model" ? "model" : "user",
    parts: m.parts.map((p) => ({ ...p }))
  }));
  const generationConfig = { topK: 40, topP: 1 };
  if (request.maxOutputTokens !== void 0) {
    generationConfig.maxOutputTokens = request.maxOutputTokens;
  }
  const innerRequest = {
    model: upstreamModel,
    contents,
    generationConfig,
    sessionId
  };
  if (request.systemInstruction) {
    innerRequest.systemInstruction = { parts: [{ text: request.systemInstruction }] };
  }
  const body = {
    project: projectId,
    model: upstreamModel,
    userAgent: ANTIGRAVITY_ENVELOPE_USER_AGENT,
    requestType: "agent",
    requestId,
    request: innerRequest
  };
  const headers = {
    ...getAntigravityContentHeaders(accessToken),
    Accept: "text/event-stream"
  };
  let lastError = null;
  for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Antigravity request timed out")), REQUEST_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort(request.abortSignal?.reason);
    request.abortSignal?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw classifyHttpError(response.status, text, request.model);
      }
      const result = await parseSSEStream(response);
      if (!result.text.trim() && result.finishReason !== "tool_calls") {
        throw new AntigravityApiError("Antigravity returned an empty response. The model may not be available on this account.", 500);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (err instanceof AntigravityModelError) throw err;
      if (err instanceof AntigravityApiError && err.status < 500) throw err;
      const isRetryable = err instanceof AntigravityApiError ? err.status === 429 || err.status >= 500 : true;
      if (!isRetryable) throw err;
    } finally {
      clearTimeout(timeout);
      request.abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
  throw lastError || new AntigravityApiError("All Antigravity endpoints failed", 502);
}
function classifyHttpError(status, bodyText, modelId) {
  const lower = bodyText.toLowerCase();
  const modelMentions = /model|not found|unavailable|does not exist|permission|entitlement/.test(lower);
  if (status === 400 && modelMentions) {
    return new AntigravityModelError(`Model "${modelId}" is not available on this account. Pick another model.`, modelId);
  }
  if (status === 403) {
    return new AntigravityApiError(`Access forbidden (403): ${trimError(bodyText, modelId)}`, 403);
  }
  if (status === 429) {
    return new AntigravityApiError(`Rate limited (429): ${trimError(bodyText, modelId)}`, 429);
  }
  return new AntigravityApiError(`Antigravity API error ${status}: ${trimError(bodyText, modelId)}`, status);
}
function trimError(text, modelId, max = 250) {
  if (!text) return `Model "${modelId}" may not be available on this account.`;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
async function parseSSEStream(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AntigravityApiError("No response body from Antigravity", 502);
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  let sawSignedText = "";
  let finishReason = "stop";
  let usage;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const streamError = parsed.error || parsed.response?.error;
        if (streamError) {
          const msg = typeof streamError === "string" ? streamError : String(streamError.message || streamError);
          throw new AntigravityApiError(`Antigravity error: ${msg}`, 500);
        }
        const markdown = typeof parsed.markdown === "string" ? parsed.markdown : typeof parsed.response?.markdown === "string" ? parsed.response.markdown : null;
        if (markdown) accumulatedText += markdown;
        const candidates = parsed.response?.candidates ?? parsed.candidates;
        if (Array.isArray(candidates) && candidates.length > 0) {
          const candidate = candidates[0];
          if (candidate.finishReason) {
            finishReason = String(candidate.finishReason).toLowerCase();
          }
          const content = candidate.content;
          const parts = Array.isArray(content?.parts) ? content.parts : [];
          for (const part of parts) {
            if (typeof part.text === "string" && !part.thought) {
              if (part.thoughtSignature) {
                sawSignedText += part.text;
              } else {
                accumulatedText += part.text;
              }
            }
          }
        }
        const metadata = parsed.response?.usageMetadata ?? parsed.usageMetadata;
        if (metadata) {
          const m = metadata;
          usage = {
            promptTokens: Number(m.promptTokenCount || 0),
            completionTokens: Number(m.candidatesTokenCount || 0),
            totalTokens: Number(m.totalTokenCount || 0)
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data !== "[DONE]") {
      try {
        const parsed = JSON.parse(data);
        const markdown = typeof parsed.markdown === "string" ? parsed.markdown : typeof parsed.response?.markdown === "string" ? parsed.response.markdown : null;
        if (markdown) accumulatedText += markdown;
      } catch {
      }
    }
  }
  const text = accumulatedText || sawSignedText;
  return { text, finishReason, usage };
}
async function sendAntigravityWithFallback(request) {
  const fallbacks = getAntigravityModelFallbacks(request.model);
  if (fallbacks.length === 0) {
    return sendAntigravityRequest(request);
  }
  let lastError = null;
  for (const fallbackId of fallbacks) {
    try {
      return await sendAntigravityRequest({ ...request, model: fallbackId });
    } catch (err) {
      lastError = err;
      if (!(err instanceof AntigravityModelError)) throw err;
    }
  }
  throw lastError || new AntigravityApiError("No fallback model worked", 502);
}
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
class TranslationIncompleteError extends Error {
  failedChunks;
  totalChunks;
  partial;
  constructor(failedChunks, totalChunks, partial) {
    const n = failedChunks.length;
    super(
      `${n} of ${totalChunks} chunk${totalChunks === 1 ? "" : "s"} failed after all retries — those lines are still in the original language. Nothing was silently skipped.`
    );
    this.name = "TranslationIncompleteError";
    this.failedChunks = failedChunks;
    this.totalChunks = totalChunks;
    this.partial = partial;
  }
}
async function translateAll(params) {
  const { entries, settings, onProgress, signal } = params;
  const chunks = chunkArray(entries, CHUNK_SIZE);
  const totalChunks = chunks.length;
  if (totalChunks === 0) return [];
  const settled = new Array(totalChunks).fill(null);
  const failedChunks = /* @__PURE__ */ new Set();
  let nextChunk = 0;
  let inflight2 = 0;
  let limit = Math.min(CONCURRENCY, totalChunks);
  let last429At = 0;
  let fatalError = null;
  const snapshot = () => {
    const out = [];
    for (let i = 0; i < totalChunks; i++) {
      out.push(...settled[i] ?? chunks[i]);
    }
    return out;
  };
  const emit = (p) => {
    onProgress({ jobId: "", ...p, activeChunks: inflight2 });
  };
  const translateChunk = async (i) => {
    const originals = chunks[i];
    const messages = buildMessages({ subtitles: originals });
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user");
    const antigravityMessages = [];
    if (userMsg && userMsg.content) {
      antigravityMessages.push({ role: "user", parts: [{ text: userMsg.content }] });
    }
    const systemInstruction = systemMsg ? systemMsg.content : void 0;
    const buildResult = (text) => {
      const cleaned = cleanAiResponse(text);
      const parsed = parseSrt(cleaned);
      return originals.map(
        (orig, j) => j < parsed.length ? { id: orig.id, startTime: orig.startTime, endTime: orig.endTime, text: parsed[j].text } : orig
      );
    };
    let saw429 = false;
    let lastError = null;
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal.aborted) throw new Error("AbortError");
      try {
        const response = await sendAntigravityWithFallback({
          model: settings.modelId,
          messages: antigravityMessages,
          systemInstruction,
          maxOutputTokens: 8192,
          abortSignal: signal
        });
        const translated = buildResult(response.text);
        lastError = null;
        return { translated: translated.length > 0 ? translated : originals, saw429 };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        const is429 = lastError instanceof AntigravityApiError && lastError.status === 429;
        const isDeterministic = lastError instanceof AntigravityModelError || lastError instanceof AntigravityApiError && lastError.status !== 429 && lastError.status < 500;
        const isRateLimit = is429 || lastError.message?.includes("429") || lastError.message?.includes("rate");
        if (isRateLimit) {
          saw429 = true;
          limit = Math.max(1, Math.floor(limit * 0.6));
          last429At = Date.now();
        }
        if (isDeterministic) {
          fatalError = lastError;
          emit({
            chunkIndex: i,
            totalChunks,
            status: "error",
            errorMessage: lastError.message
          });
          throw lastError;
        }
        if (attempt < maxAttempts - 1) {
          if (isRateLimit) {
            const waitMs = Math.min(1e4 * Math.pow(1.5, attempt), 6e4);
            emit({
              chunkIndex: i,
              totalChunks,
              status: "sending",
              errorMessage: `Rate limited, waiting ${Math.round(waitMs / 1e3)}s...`
            });
            await delay(waitMs);
          } else {
            await delay(1e3 * Math.pow(2, attempt));
          }
        }
      }
    }
    failedChunks.add(i);
    emit({
      chunkIndex: i,
      totalChunks,
      status: "error",
      errorMessage: lastError?.message
    });
    return { translated: originals, saw429 };
  };
  const runChunk = async (i) => {
    let translated;
    let saw429 = false;
    try {
      const r = await translateChunk(i);
      translated = r.translated;
      saw429 = r.saw429;
    } catch (err) {
      if (fatalError && !(err instanceof Error && err.name === "AbortError")) {
        fatalError = err;
      }
      settled[i] = chunks[i];
      saw429 = false;
      emit({
        chunkIndex: i,
        totalChunks,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        partialResult: snapshot()
      });
      return;
    }
    settled[i] = translated;
    emit({
      chunkIndex: i,
      totalChunks,
      status: "received",
      partialResult: snapshot()
    });
    if (!saw429 && Date.now() - last429At > 8e3 && limit < CONCURRENCY) {
      limit++;
    }
  };
  while (nextChunk < totalChunks && !signal.aborted && !fatalError) {
    while (inflight2 >= limit && !signal.aborted && !fatalError) {
      await delay(40);
    }
    if (signal.aborted || fatalError) break;
    const i = nextChunk++;
    inflight2++;
    emit({ chunkIndex: i, totalChunks, status: "sending" });
    runChunk(i).finally(() => {
      inflight2--;
    });
  }
  while (inflight2 > 0 && !signal.aborted) {
    await delay(40);
  }
  if (signal.aborted) throw new Error("AbortError");
  if (fatalError) throw fatalError;
  const results = [];
  for (let i = 0; i < totalChunks; i++) {
    results.push(...settled[i] ?? chunks[i]);
  }
  if (failedChunks.size > 0) {
    throw new TranslationIncompleteError(
      [...failedChunks].sort((a, b) => a - b),
      totalChunks,
      results
    );
  }
  return results;
}
async function loadCodeAssist(accessToken) {
  const headers = getAntigravityContentHeaders(accessToken);
  const metadata = getAntigravityLoadCodeAssistMetadata();
  for (const endpoint of ANTIGRAVITY_LOAD_CODE_ASSIST_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ metadata }),
        signal: AbortSignal.timeout(1e4)
      });
      if (!response.ok) continue;
      const data = await response.json();
      const project = data.cloudaicompanionProject;
      const projectId = typeof project === "string" ? project : typeof project === "object" && project && "id" in project ? String(project.id) : null;
      if (!projectId) return null;
      const tierId = extractTierId(data);
      const plan = mapTierIdToPlan(tierId);
      return { projectId, tierId, plan };
    } catch {
    }
  }
  return null;
}
async function onboardUser(accessToken, tierId = "free-tier") {
  const headers = getAntigravityContentHeaders(accessToken);
  const metadata = getAntigravityLoadCodeAssistMetadata();
  for (const endpoint of ANTIGRAVITY_ONBOARD_USER_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ tier_id: tierId, metadata }),
        signal: AbortSignal.timeout(3e4)
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data.done === true && data.response) {
        const project = data.response.cloudaicompanionProject;
        const projectId = typeof project === "string" ? project : typeof project === "object" && project && "id" in project ? String(project.id) : null;
        if (projectId) {
          const tier = extractTierId(data);
          const plan = mapTierIdToPlan(tier);
          return { projectId, tierId: tier, plan };
        }
      }
    } catch {
    }
  }
  return null;
}
async function fetchUserInfo(accessToken) {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.email) return null;
    return { email: data.email, picture: data.picture };
  } catch {
    return null;
  }
}
function extractTierId(data) {
  const currentTier = data.currentTier;
  if (currentTier?.id && typeof currentTier.id === "string") return currentTier.id;
  const allowedTiers = data.allowedTiers;
  if (Array.isArray(allowedTiers)) {
    for (const tier of allowedTiers) {
      if (tier.isDefault === true && tier.id && typeof tier.id === "string") {
        return tier.id;
      }
    }
    if (allowedTiers.length > 0 && allowedTiers[0]?.id && typeof allowedTiers[0].id === "string") {
      return allowedTiers[0].id;
    }
  }
  const subscription = data.subscription;
  if (subscription?.tier && typeof subscription.tier === "string") return subscription.tier;
  return "free-tier";
}
function mapTierIdToPlan(tierId) {
  const upper = tierId.toUpperCase();
  if (upper.includes("ULTRA")) return "Ultra";
  if (upper.includes("PRO") || upper.includes("PREMIUM") || upper.includes("GOOGLE_ONE")) return "Pro";
  if (upper.includes("ENTERPRISE")) return "Enterprise";
  if (upper.includes("BUSINESS") || upper.includes("STANDARD")) return "Business";
  if (upper.includes("PLUS")) return "Plus";
  if (upper.includes("LITE")) return "Lite";
  return "Free";
}
const quotaCache = /* @__PURE__ */ new Map();
const inflight = /* @__PURE__ */ new Map();
function cacheKey(accessToken, projectId) {
  return `${accessToken.substring(0, 16)}:${projectId || "default"}`;
}
function isFresh(key) {
  const entry = quotaCache.get(key);
  return !!entry && Date.now() - entry.fetchedAt < ANTIGRAVITY_QUOTA_CACHE_TTL_MS;
}
async function withCache(key, fetcher, forceRefresh = false) {
  if (!forceRefresh && isFresh(key)) {
    return quotaCache.get(key).data;
  }
  const inFlight = inflight.get(key);
  if (inFlight) return inFlight;
  const promise = fetcher().then((data) => {
    quotaCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  }).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
async function fetchAvailableModels(accessToken, projectId, forceRefresh = false) {
  const key = `models:${cacheKey(accessToken, projectId)}`;
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken);
    const body = projectId ? { project: projectId } : {};
    for (const url of ANTIGRAVITY_FETCH_AVAILABLE_MODELS_URLS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(1e4)
        });
        if (res.status === 403) {
          return { __forbidden: true };
        }
        if (!res.ok) continue;
        return await res.json();
      } catch {
      }
    }
    throw new Error("Failed to fetch available models from all endpoints");
  }, forceRefresh);
}
async function retrieveUserQuota(accessToken, projectId, forceRefresh = false) {
  if (!projectId) return {};
  const key = `quota:${cacheKey(accessToken, projectId)}`;
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken);
    const body = { project: projectId };
    for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
      try {
        const url = `${baseUrl}/v1internal:retrieveUserQuota`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(1e4)
        });
        if (!res.ok) continue;
        return await res.json();
      } catch {
      }
    }
    return {};
  }, forceRefresh);
}
async function retrieveUserQuotaSummary(accessToken, projectId, forceRefresh = false) {
  if (!projectId) return {};
  const key = `summary:${cacheKey(accessToken, projectId)}`;
  return withCache(key, async () => {
    const headers = getAntigravityContentHeaders(accessToken);
    const body = { project: projectId };
    for (const baseUrl of ANTIGRAVITY_RUNTIME_BASE_URLS) {
      try {
        const url = `${baseUrl}/v1internal:retrieveUserQuotaSummary`;
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(1e4)
        });
        if (!res.ok) continue;
        return await res.json();
      } catch {
      }
    }
    return {};
  });
}
function parseResetTime(val) {
  if (!val) return null;
  if (typeof val === "string") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof val === "number") {
    const d = new Date(val < 1e12 ? val * 1e3 : val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
function normalizeQuotaBucket(bucket, modelId, source) {
  const rawFraction = typeof bucket.remainingFraction === "number" ? bucket.remainingFraction : -1;
  if (rawFraction < 0) {
    return null;
  }
  const fraction = Math.max(0, Math.min(1, rawFraction));
  const resetAt = parseResetTime(bucket.resetTime);
  const unlimited = !resetAt && fraction >= 1;
  const total = 1e3;
  const remaining = Math.round(total * fraction);
  const used = unlimited ? 0 : Math.max(0, total - remaining);
  return {
    id: modelId,
    name: getAntigravityModelName(modelId),
    used,
    total: unlimited ? 0 : total,
    remainingPercentage: unlimited ? 100 : fraction * 100,
    resetAt,
    unlimited,
    fractionReported: true
  };
}
function parseAvailableModels(data, userQuotaData) {
  const models = data.models;
  if (!models) return [];
  const userQuotaMap = /* @__PURE__ */ new Map();
  const buckets = userQuotaData.buckets;
  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      const id = String(bucket.modelId || "").trim();
      if (id) userQuotaMap.set(id, bucket);
    }
  }
  const result = [];
  for (const [rawId, info] of Object.entries(models)) {
    const infoObj = info;
    if (infoObj.isInternal === true) continue;
    const modelId = resolveAntigravityModelId(rawId);
    if (!modelId || !isDiscoverableAntigravityModelId(modelId)) continue;
    const quotaInfo = infoObj.quotaInfo;
    if (!quotaInfo || Object.keys(quotaInfo).length === 0) continue;
    const liveBucket = userQuotaMap.get(modelId);
    const bucketData = liveBucket || quotaInfo;
    const normalized = normalizeQuotaBucket(bucketData, modelId);
    if (normalized) result.push(normalized);
  }
  for (const [modelId, bucket] of userQuotaMap) {
    if (result.some((m) => m.id === modelId)) continue;
    if (!isDiscoverableAntigravityModelId(modelId)) continue;
    const normalized = normalizeQuotaBucket(bucket, modelId);
    if (normalized) result.push(normalized);
  }
  return result;
}
function parseWeeklyQuotas(data) {
  const result = [];
  const groups = Array.isArray(data.groups) ? data.groups : Array.isArray(data.quotaSummary?.groups) ? data.quotaSummary.groups : [];
  for (const groupRaw of groups) {
    const group = groupRaw;
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    const weeklyBucket = buckets.find(
      (b) => b && typeof b === "object" && /weekly/i.test(String(b.bucketId || "") + String(b.displayName || ""))
    );
    if (!weeklyBucket || weeklyBucket.disabled === true) continue;
    const key = String(group.displayName || "").toLowerCase().replace(/\bmodels?\b/g, "").replace(/\band\b/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) continue;
    const rawFraction = typeof weeklyBucket.remainingFraction === "number" ? weeklyBucket.remainingFraction : -1;
    if (rawFraction < 0) continue;
    const fraction = Math.max(0, Math.min(1, rawFraction));
    const resetAt = parseResetTime(weeklyBucket.resetTime);
    const unlimited = !resetAt && fraction >= 1;
    const total = 1e3;
    const remaining = Math.round(total * fraction);
    const used = unlimited ? 0 : Math.max(0, total - remaining);
    result.push({
      key: `${key}_weekly`,
      displayName: String(group.displayName || "").trim() || key,
      used,
      total: unlimited ? 0 : total,
      remainingPercentage: unlimited ? 100 : fraction * 100,
      resetAt,
      unlimited
    });
  }
  return result;
}
async function fetchQuota(accessToken, projectId, forceRefresh = false) {
  if (!accessToken || !projectId) {
    return { models: [], weekly: [], plan: "Free" };
  }
  const [modelsData, quotaData, summaryData] = await Promise.all([
    fetchAvailableModels(accessToken, projectId, forceRefresh).catch(() => ({})),
    retrieveUserQuota(accessToken, projectId, forceRefresh).catch(() => ({})),
    retrieveUserQuotaSummary(accessToken, projectId, forceRefresh).catch(() => ({}))
  ]);
  const models = parseAvailableModels(modelsData, quotaData);
  const weekly = parseWeeklyQuotas(summaryData);
  let plan = "Free";
  const modelsRecord = modelsData;
  const quotaRecord = quotaData;
  const tier = modelsRecord.tier ?? quotaRecord.currentTier ?? modelsRecord.currentTier;
  if (tier?.id && typeof tier.id === "string") {
    const upper = tier.id.toUpperCase();
    if (upper.includes("ULTRA")) plan = "Ultra";
    else if (upper.includes("PRO") || upper.includes("PREMIUM") || upper.includes("GOOGLE_ONE")) plan = "Pro";
    else if (upper.includes("ENTERPRISE")) plan = "Enterprise";
    else if (upper.includes("BUSINESS") || upper.includes("STANDARD")) plan = "Business";
    else if (upper.includes("PLUS")) plan = "Plus";
    else if (upper.includes("LITE")) plan = "Lite";
  }
  return { models, weekly, plan };
}
const jobs = /* @__PURE__ */ new Map();
let authListener = null;
let authTimeout = null;
function clearAuthTimeout() {
  if (authTimeout) {
    clearTimeout(authTimeout);
    authTimeout = null;
  }
}
function emitAuthProgress(window, progress) {
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.AUTH_PROGRESS, progress);
  }
}
function emitAuthStateChanged(window) {
  const status = {
    signedIn: !!getSession(),
    account: getAccount(),
    needsReauth: false
  };
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.AUTH_STATE_CHANGED, status);
  }
}
function registerIpcHandlers(getWindow) {
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_CAN_PERSIST, () => {
    return { success: true, data: canPersistSession() };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_BEGIN, async () => {
    const window = getWindow();
    if (authListener) {
      authListener.close();
      authListener = null;
    }
    clearAuthTimeout();
    try {
      authListener = startOAuthListener();
      const redirectUri = await awaitRedirectUri(authListener);
      const state = generateOAuthState();
      const authUrl = buildAuthUrl(redirectUri, state);
      emitAuthProgress(window, { phase: "opening-browser", message: "Opening Google sign-in...", authUrl });
      const { shell } = await import("electron");
      await shell.openExternal(authUrl);
      emitAuthProgress(window, { phase: "waiting-callback", message: "Waiting for Google callback..." });
      const timeoutMs = 5 * 60 * 1e3;
      let resolved = false;
      const codePromise = authListener.waitForCode;
      const timeoutPromise = new Promise((_, reject) => {
        authTimeout = setTimeout(() => {
          reject(new Error("OAuth timeout (5 minutes)"));
        }, timeoutMs);
      });
      const result = await Promise.race([codePromise, timeoutPromise]);
      clearAuthTimeout();
      resolved = true;
      if (!result || !result.code) {
        throw new Error("No authorization code received");
      }
      emitAuthProgress(window, { phase: "exchanging", message: "Exchanging code for tokens..." });
      const tokens = await exchangeCodeForTokens(result.code, redirectUri);
      emitAuthProgress(window, { phase: "onboarding", message: "Loading account info..." });
      const userInfo = await fetchUserInfo(tokens.accessToken);
      if (!userInfo) {
        throw new Error("Could not fetch user info");
      }
      let loadResult = await loadCodeAssist(tokens.accessToken);
      if (!loadResult) {
        loadResult = await onboardUser(tokens.accessToken);
        if (!loadResult) {
          throw new Error("No Cloud Code project available for this account");
        }
      }
      const session2 = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1e3 : void 0,
        email: userInfo.email,
        picture: userInfo.picture,
        plan: loadResult.plan,
        projectId: loadResult.projectId,
        tierId: loadResult.tierId,
        connectedAt: Date.now()
      };
      setSession(session2);
      emitAuthProgress(window, { phase: "complete", message: "Signed in successfully" });
      emitAuthStateChanged(window);
      if (authListener) {
        authListener.close();
        authListener = null;
      }
      return { success: true, data: { phase: "complete", message: "Signed in successfully" } };
    } catch (err) {
      clearAuthTimeout();
      if (authListener) {
        authListener.close();
        authListener = null;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      emitAuthProgress(window, { phase: "error", message: errorMsg });
      return { success: false, error: errorMsg };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_CANCEL, async () => {
    if (authListener) {
      authListener.close();
      authListener = null;
    }
    clearAuthTimeout();
    const window = getWindow();
    emitAuthProgress(window, { phase: "cancelled", message: "Sign-in cancelled" });
    return { success: true };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    if (!getSession()) {
      await restoreSession().catch(() => false);
    }
    const session2 = getSession();
    const status = {
      signedIn: !!session2,
      account: getAccount(),
      needsReauth: false
    };
    if (session2) {
      try {
        const token = await getAccessToken();
        if (!token) {
          status.needsReauth = true;
          status.signedIn = false;
        }
      } catch {
        status.needsReauth = true;
        status.signedIn = false;
      }
    }
    return { success: true, data: status };
  });
  electron.ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    await logout();
    const window = getWindow();
    emitAuthStateChanged(window);
    return { success: true };
  });
  async function loadQuota(forceRefresh = false) {
    const session2 = getSession();
    if (!session2) {
      return { success: false, error: "Not signed in" };
    }
    try {
      const token = await getAccessToken();
      if (!token) {
        return { success: false, error: "Session expired, please sign in again" };
      }
      const result = await fetchQuota(token, session2.projectId, forceRefresh);
      const models = result.models.map((m) => ({
        id: m.id,
        name: m.name,
        used: m.used,
        total: m.total,
        remainingPercentage: m.remainingPercentage,
        resetAt: m.resetAt,
        unlimited: m.unlimited,
        fractionReported: m.fractionReported
      }));
      const weekly = result.weekly.map((w) => ({
        key: w.key,
        displayName: w.displayName,
        used: w.used,
        total: w.total,
        remainingPercentage: w.remainingPercentage,
        resetAt: w.resetAt,
        unlimited: w.unlimited
      }));
      return {
        success: true,
        data: {
          plan: result.plan,
          models,
          weekly,
          credits: null,
          fetchedAt: Date.now()
        }
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  electron.ipcMain.handle(IPC_CHANNELS.QUOTA_GET, () => loadQuota(false));
  electron.ipcMain.handle(IPC_CHANNELS.QUOTA_REFRESH, () => loadQuota(true));
  electron.ipcMain.handle(IPC_CHANNELS.LIST_MODELS, async () => {
    const session2 = getSession();
    if (!session2) {
      return { success: false, error: "Not signed in" };
    }
    try {
      const token = await getAccessToken();
      if (!token) {
        return { success: false, error: "Session expired, please sign in again" };
      }
      const quotaResult = await fetchQuota(token, session2.projectId);
      const availableIds = quotaResult.models.map((m) => m.id);
      if (availableIds.length > 0) {
        const models = pickChatModels(availableIds);
        return { success: true, data: models };
      }
      return {
        success: true,
        data: ANTIGRAVITY_PUBLIC_MODELS.map((m) => ({ id: m.id, name: m.name }))
      };
    } catch (err) {
      return {
        success: true,
        data: ANTIGRAVITY_PUBLIC_MODELS.map((m) => ({ id: m.id, name: m.name }))
      };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.IMPORT_SRT, async () => {
    try {
      const result = await importSrtFile();
      if (!result) return { success: true, data: null };
      const entries = parseSrt(result.content);
      return { success: true, data: { filePath: result.filePath, fileName: result.fileName, entries } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.EXPORT_SRT, async (_event, entries, suggestedName) => {
    try {
      const content = serializeSrt(entries);
      const savedPath = await exportSrtFile(content, suggestedName);
      return { success: true, data: savedPath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.IMPORT_SRT_PATH, async (_event, filePath) => {
    try {
      const content = await promises.readFile(filePath, "utf-8");
      const entries = parseSrt(content);
      return { success: true, data: { filePath, fileName: path.basename(filePath), entries } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.SELECT_MKV, async () => {
    try {
      const path2 = await selectMkvFile();
      return { success: true, data: path2 };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.LIST_MKV_TRACKS, async (_event, mkvPath) => {
    try {
      const { getMkvSubtitleTracks } = await Promise.resolve().then(() => require("./chunks/mkv-extract-B5ec9EDY.js"));
      const tracks = await getMkvSubtitleTracks(mkvPath);
      return { success: true, data: tracks };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.EXTRACT_MKV_TRACK, async (_event, mkvPath, trackId) => {
    try {
      const { getMkvSubtitleTracks, extractMkvSubtitleTrack } = await Promise.resolve().then(() => require("./chunks/mkv-extract-B5ec9EDY.js"));
      const tracks = await getMkvSubtitleTracks(mkvPath);
      const track = tracks.find((t) => t.id === trackId);
      if (!track) return { success: false, error: `Track ${trackId} not found in movie.` };
      const result = await extractMkvSubtitleTrack(mkvPath, track);
      return { success: true, data: result };
    } catch (err) {
      const code = err.code;
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: code === "IMAGE_SUBTITLE" ? { imageSubtitle: true } : void 0 };
    }
  });
  electron.ipcMain.on(IPC_CHANNELS.START_TRANSLATION, async (_event, entries, settings, jobId) => {
    const window = getWindow();
    const controller = new AbortController();
    jobs.set(jobId, controller);
    try {
      const results = await translateAll({
        entries,
        settings,
        signal: controller.signal,
        onProgress: (progress) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.TRANSLATION_PROGRESS, { ...progress, jobId });
          }
        }
      });
      jobs.delete(jobId);
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, { success: true, data: results, jobId });
      }
    } catch (err) {
      jobs.delete(jobId);
      const incomplete = err instanceof TranslationIncompleteError ? err : null;
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.TRANSLATION_COMPLETE, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          jobId,
          ...incomplete ? {
            partialData: incomplete.partial,
            failedChunks: incomplete.failedChunks,
            totalChunks: incomplete.totalChunks
          } : {}
        });
      }
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.CANCEL_TRANSLATION, async (_event, jobId) => {
    try {
      if (jobId) {
        jobs.get(jobId)?.abort();
        jobs.delete(jobId);
      } else {
        for (const controller of jobs.values()) controller.abort();
        jobs.clear();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
if (process.platform === "linux") {
  const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ""} ${process.env.KDE_FULL_SESSION ?? ""}`;
  const isKde = /kde|plasma/i.test(desktop);
  if (!isKde && !process.argv.some((a) => a.startsWith("--password-store"))) {
    electron.app.commandLine.appendSwitch("password-store", "gnome-libsecret");
  }
}
let mainWindow = null;
const DEFAULT_SIZE = { width: 1236, height: 958 };
function stateFile() {
  const dir = electron.app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "window-state.json");
}
function loadSavedBounds() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (typeof data.width === "number" && typeof data.height === "number") {
      return { width: data.width, height: data.height };
    }
  } catch {
  }
  return null;
}
function createWindow() {
  electron.Menu.setApplicationMenu(null);
  const saved = loadSavedBounds() ?? DEFAULT_SIZE;
  const workArea = electron.screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(400, Math.min(saved.width, workArea.width));
  const height = Math.max(400, Math.min(saved.height, workArea.height));
  mainWindow = new electron.BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  let saveTimer = null;
  const persistNow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const [w, h] = mainWindow.getSize();
      fs.writeFileSync(stateFile(), JSON.stringify({ width: w, height: h }));
    } catch {
    }
  };
  mainWindow.on("resize", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 300);
  });
  mainWindow.on("close", persistNow);
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
registerIpcHandlers(() => mainWindow);
electron.app.whenReady().then(createWindow);
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
});
exports.parseSrt = parseSrt;
