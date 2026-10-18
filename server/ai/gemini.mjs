/**
 * Gemini adapter (@google/genai). Picks a model the key can actually reach via
 * live discovery, calls the Interactions API with a JSON-schema response format
 * (falling back to the legacy generateContent surface if needed), never asks
 * Google to store the request, and classifies every failure so the caller can
 * fall back to the offline engine with an honest reason.
 */
import { GoogleGenAI, ApiError } from '@google/genai';

// Current stable Flash models first (Oct 2026). Concrete IDs keep behaviour reproducible;
// `gemini-flash-latest` (an alias — 3.8-flash today, sharing its quota) keeps Nadi working
// if these are ever retired. Models with separate quotas come first for 429 failover.
export const PREFERRED_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

const state = {
  client: null,
  keyHint: null,
  model: null,
  available: null,
  surface: 'interactions',
  lastError: null,
  lastOkAt: null,
  calls: 0,
  noThinking: new Set(), // models that rejected the reasoning-depth setting
  cooldown: new Map(), // model -> time its rate limit is expected to reset
};

// Free-tier quotas are per model: a model that returns 429 rests this long while others answer.
const QUOTA_COOLDOWN_MS = 60_000;

export function configure(apiKey) {
  state.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  state.keyHint = apiKey ? `…${apiKey.slice(-4)}` : null;
  state.model = null;
  state.available = null;
  state.surface = 'interactions';
  state.lastError = null;
  state.noThinking.clear();
  state.cooldown.clear();
}

const cooling = (m) => (state.cooldown.get(m) || 0) > Date.now();
/** Next preferred model this key can reach that is not resting after a 429. */
const nextModel = (current) => PREFERRED_MODELS.find((n) => n !== current && (!state.available || state.available.includes(n)) && !cooling(n));

export const isConfigured = () => !!state.client;

export function status() {
  return {
    configured: !!state.client,
    key: state.keyHint,
    model: state.model || process.env.GEMINI_MODEL || null,
    surface: state.surface,
    available_models: state.available ? state.available.filter((m) => /^gemini/.test(m)).slice(0, 30) : null,
    last_error: state.lastError,
    last_ok_at: state.lastOkAt,
    calls: state.calls,
    resting_models: [...state.cooldown].filter(([, until]) => until > Date.now()).map(([m, until]) => ({ model: m, seconds: Math.ceil((until - Date.now()) / 1000) })),
  };
}

/** Classify an error into something a UI can explain. */
export function describeError(e) {
  const msg = String((e && e.message) || e || 'unknown error');
  const status = e instanceof ApiError ? e.status : e && e.status;
  let kind = 'unknown';
  if (msg === 'timeout') kind = 'timeout';
  else if (/api key not valid|api_key_invalid|invalid api key|permission denied|unauthenticated/i.test(msg) || status === 401 || status === 403) kind = 'auth';
  else if (status === 429 || /quota|rate limit|resource.?exhausted/i.test(msg)) kind = 'quota';
  // e.g. "Thinking level THINKING_LEVEL_MINIMAL is not supported for this model" — a parameter problem, not a missing model.
  else if (/thinking/i.test(msg) && (status === 400 || status == null)) kind = 'thinking';
  else if (status === 404 || /not found|unknown model|does not exist/i.test(msg)) kind = 'model';
  else if (status >= 500) kind = 'server';
  else if (/fetch failed|enotfound|econnrefused|econnreset|network|socket/i.test(msg)) kind = 'network';
  else if (status === 400) kind = 'request';
  const human = {
    auth: 'The Gemini API key was rejected. Check the key in Settings.',
    quota: 'Gemini quota or rate limit reached (common on the free tier). Try again in a minute.',
    model: 'The selected Gemini model is not available for this key.',
    server: 'Gemini had a temporary server error.',
    network: 'Could not reach Gemini (no internet connection?).',
    timeout: 'Gemini took too long to respond.',
    thinking: 'The model rejected the reasoning-depth setting.',
    request: 'Gemini rejected the request format.',
    unknown: 'Unexpected Gemini error.',
  }[kind];
  return { kind, status: status ?? null, message: human, detail: msg.slice(0, 300) };
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]);
}

/** Lists models the key can use and caches the result. */
export async function discoverModels() {
  if (!state.client) throw new Error('Gemini is not configured');
  const names = [];
  const pager = await withTimeout(state.client.models.list({ config: { pageSize: 200 } }), 15000);
  for await (const m of pager) {
    const actions = m.supportedActions || [];
    if (!actions.length || actions.includes('generateContent')) names.push(String(m.name || '').replace(/^models\//, ''));
  }
  // An empty listing is a discovery quirk, not "no models": treat as unknown so failover still works.
  state.available = names.length ? names : null;
  return names;
}

async function pickModel() {
  if (process.env.GEMINI_MODEL) return (state.model = process.env.GEMINI_MODEL);
  if (state.model) return state.model;
  try {
    const names = await discoverModels();
    state.model = PREFERRED_MODELS.find((n) => names.includes(n))
      || names.find((n) => /^gemini-[\d.]+-flash$/.test(n))
      || names.find((n) => /^gemini-.*flash/.test(n))
      || PREFERRED_MODELS[0];
  } catch (e) {
    // Discovery failing (e.g. bad key) is reported by the real call below.
    state.model = PREFERRED_MODELS[0];
    if (describeError(e).kind === 'auth') throw e;
  }
  return state.model;
}

/** Tolerant JSON extraction: strips code fences and surrounding prose if a model adds them. */
export function parseJsonLoose(text) {
  const bad = (msg) => Object.assign(new Error(msg), { badOutput: true });
  if (typeof text !== 'string' || !text.trim()) throw bad('empty model output');
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw bad('model output was not valid JSON');
}

/** Interactions-style content blocks ({type:'text'|'image'|'document'}) as generateContent parts. */
export function toGenerateContents(input) {
  if (!Array.isArray(input)) return input;
  const parts = input.map((c) => (c.type === 'text' ? { text: c.text } : { inlineData: { mimeType: c.mime_type, data: c.data } }));
  return [{ role: 'user', parts }];
}

async function callOnce(model, opts) {
  const { system, input, schema, thinking, timeoutMs } = opts;
  const useThinking = thinking && !state.noThinking.has(model);
  if (state.surface === 'interactions') {
    try {
      const res = await withTimeout(state.client.interactions.create({
        model,
        input,
        system_instruction: system,
        response_format: { type: 'text', mime_type: 'application/json', schema },
        generation_config: useThinking ? { thinking_level: thinking } : undefined,
        store: false, // health data: do not keep the request/response for later retrieval
      }), timeoutMs);
      if (typeof res.output_text === 'string' && res.output_text.trim()) return res.output_text;
      throw Object.assign(new Error(`interaction finished without text (status: ${res.status || 'unknown'})`), { surfaceProblem: true });
    } catch (e) {
      const kind = describeError(e).kind;
      // The model dislikes this reasoning depth: same model, model's own default depth.
      if (kind === 'thinking' && useThinking) { state.noThinking.add(model); return callOnce(model, opts); }
      if (!e.surfaceProblem && ['auth', 'quota', 'model', 'timeout', 'network'].includes(kind)) throw e;
      // Interactions surface unavailable for this key/model: use generateContent from now on.
      state.surface = 'generateContent';
    }
  }
  const res = await withTimeout(state.client.models.generateContent({
    model,
    contents: toGenerateContents(input),
    config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema },
  }), timeoutMs);
  return res.text;
}

/**
 * Generate a schema-constrained JSON object.
 * Returns { json, model, surface, latencyMs } or throws (caller falls back offline).
 */
export async function generateJSON({ system, input, schema, thinking = 'low', timeoutMs = 45000 }) {
  if (!state.client) throw new Error('Gemini is not configured');
  const started = Date.now();
  state.calls++;
  let model;
  try {
    model = await pickModel();
  } catch (e) {
    state.lastError = { ...describeError(e), at: new Date().toISOString() };
    throw e;
  }
  // A preferred model resting after a 429 hands over to the next one until its quota resets.
  if (cooling(model) && !process.env.GEMINI_MODEL) model = nextModel(model) || model;
  const opts = { system, input, schema, thinking, timeoutMs };
  let text;
  try {
    text = await callOnce(model, opts);
  } catch (e) {
    const info = describeError(e);
    const next = process.env.GEMINI_MODEL ? null : nextModel(model);
    if (!next || !['model', 'quota'].includes(info.kind)) { state.lastError = { ...info, at: new Date().toISOString() }; throw e; }
    if (info.kind === 'model') state.model = next; // gone for this key: switch for good
    else state.cooldown.set(model, Date.now() + QUOTA_COOLDOWN_MS); // rate-limited: rest it, answer with the next model
    model = next;
    try {
      text = await callOnce(model, opts);
    } catch (e2) {
      const info2 = describeError(e2);
      if (info2.kind === 'quota') state.cooldown.set(model, Date.now() + QUOTA_COOLDOWN_MS);
      state.lastError = { ...info2, at: new Date().toISOString() };
      throw e2;
    }
  }
  const json = parseJsonLoose(text);
  state.lastError = null;
  state.lastOkAt = new Date().toISOString();
  return { json, model, surface: state.surface, latencyMs: Date.now() - started };
}

/** Test hook: inject a fake client (and the model list it "can see") without touching the network. */
export function _useClientForTests(client, available) {
  configure(null);
  state.client = client;
  state.available = available;
  state.keyHint = '…test';
}

/** Cheap end-to-end check used by Settings → "Test connection". */
export async function testConnection() {
  const out = await generateJSON({
    system: 'You are a connectivity check. Reply with the JSON object only.',
    input: 'Return {"ok": true, "says": "<a 3-word greeting in Hindi>"}.',
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, says: { type: 'string' } }, required: ['ok', 'says'] },
    thinking: 'low', // 'minimal' is not supported by every model
    timeoutMs: 20000,
  });
  return { ok: out.json.ok === true, says: out.json.says, model: out.model, surface: out.surface, latencyMs: out.latencyMs };
}
