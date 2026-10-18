/**
 * Nadi server — zero-framework HTTP(S) server: JSON API + static PWA.
 *
 * Privacy model: patient data is only reachable from this computer (loopback)
 * or from a phone the owner explicitly paired by QR code (HttpOnly device
 * cookie). Everyone else on the network can reach only the doctor-handoff
 * links the patient chose to share, which expire and can be revoked.
 */
import { ROOT, ENV_FILE } from './env.mjs';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import * as db from './db.mjs';
import { SYMPTOMS, COMMON_CHIPS } from './clinical/lexicon.mjs';
import { RULES, GUARD_VERSION } from './clinical/guardrails.mjs';
import { TWIN_METRICS } from './clinical/baseline.mjs';
import { resolveIngredients, localDayKey } from './clinical/meds.mjs';
import { initAI, aiStatus, setGeminiKey, testGemini, describeAiError } from './ai/index.mjs';
import { runTriage, episodeView, twinData, runInsights, createHandoff, readHandoff, medsOverview, consultView, vitalsMessage, readDocument } from './services.mjs';
import * as chat from './chat.mjs';
import { seedDemo } from './seed.mjs';

const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PUBLIC = path.join(ROOT, 'public');
const PORT = +(process.env.PORT || 3000);
const HTTPS_PORT = +(process.env.HTTPS_PORT || 3443);
const CERT_DIR = path.join(ROOT, 'certs');
const HAS_CERTS = existsSync(path.join(CERT_DIR, 'key.pem')) && existsSync(path.join(CERT_DIR, 'cert.pem'));

initAI();

/* ---------------- helpers ---------------- */

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(data);
}

function readJson(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0, tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Keep draining (without buffering) so the client receives a proper 413 instead of a reset.
      if (size > limit) tooLarge = true; else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Request too large'));
      if (!chunks.length) return resolve({});
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new HttpError(400, 'Invalid JSON body')); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new HttpError(400, 'Request body must be a JSON object'));
      resolve(body);
    });
    req.on('error', reject);
  });
}

/** Trimmed string from a string (or finite number) only — objects never become "[object Object]". */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v).slice(0, max) : '');
const strList = (a, maxItems, maxLen) => (Array.isArray(a) ? a.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress);

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isPatient(req) {
  if (isLoopback(req)) return true;
  const token = cookies(req).nadi_device;
  return !!(token && /^[A-Za-z0-9_-]{20,64}$/.test(token) && db.touchDevice(token));
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|wsl|docker|hyper-v|loopback|bluetooth|tailscale|zerotier/i.test(name)) continue;
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  const score = (x) => (/^192\.168\./.test(x.address) ? 3 : /^10\./.test(x.address) ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(x.address) ? 1 : 0) + (/wi-?fi|wlan|wireless/i.test(x.name) ? 2 : 0);
  return out.sort((a, b) => score(b) - score(a)).map((x) => x.address);
}

/** Best URL another device on the same network can open (HTTPS preferred: phone cameras need it). */
function shareBase() {
  const ip = lanAddresses()[0];
  if (!ip) return { url: `http://localhost:${PORT}`, lan: false, https: false };
  return HAS_CERTS ? { url: `https://${ip}:${HTTPS_PORT}`, lan: true, https: true } : { url: `http://${ip}:${PORT}`, lan: true, https: false };
}

const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0b0b', light: '#ffffff' } });

/* ---------------- input sanitising ---------------- */

const num = (v, lo, hi) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const CONTEXT_TAGS = new Set(['resting', 'post_exercise', 'after_caffeine', 'unwell', 'after_meal', 'stressed', 'morning', 'evening', 'well_rested', 'poor_sleep']);
const VOICE_FLAGS = new Set(['jitter_high', 'shimmer_high', 'hnr_low', 'mpt_short', 'clipping']);
const numArray = (a, max, lo = -10, hi = 10) => (Array.isArray(a) ? a.slice(0, max).map((x) => num(x, lo, hi) ?? 0) : null);

function cleanReading(b) {
  const voice = b.voice && typeof b.voice === 'object' ? {
    ok: !!b.voice.ok, f0: num(b.voice.f0, 40, 600), f0Sd: num(b.voice.f0Sd, 0, 200), jitter: num(b.voice.jitter, 0, 50), shimmer: num(b.voice.shimmer, 0, 100),
    hnr: num(b.voice.hnr, -20, 60), mpt: num(b.voice.mpt, 0, 120), voicedS: num(b.voice.voicedS, 0, 120), cycles: num(b.voice.cycles, 0, 100000),
    quality: num(b.voice.quality, 0, 100), stability: num(b.voice.stability, 0, 100), snrDb: num(b.voice.snrDb, -40, 120),
    flags: Array.isArray(b.voice.flags) ? b.voice.flags.filter((f) => VOICE_FLAGS.has(f)) : [],
  } : null;
  const d = b.detail && typeof b.detail === 'object' ? b.detail : {};
  const detail = {
    waveform: numArray(d.waveform, 600, -1.5, 1.5), waveformFs: num(d.waveformFs, 1, 120), beats: numArray(d.beats, 120, 0, 60),
    spectrum: Array.isArray(d.spectrum) ? d.spectrum.slice(0, 200).map((p) => ({ bpm: num(p && p.bpm, 0, 400) ?? 0, p: num(p && p.p, 0, 1) ?? 0 })) : null,
    snr: num(d.snr, -60, 60), durationS: num(d.durationS, 0, 600), fsActual: num(d.fsActual, 0, 240), skin: num(d.skin, 0, 1), motion: num(d.motion, 0, 100),
    hrBeats: num(d.hrBeats, 20, 250), sdnn: num(d.sdnn, 0, 400), hrvReliability: ['good', 'fair'].includes(d.hrvReliability) ? d.hrvReliability : null,
    hrvWithheld: d.hrvWithheld && typeof d.hrvWithheld === 'object' ? { reason: str(d.hrvWithheld.reason, 20) || 'noise', timingNoiseMs: num(d.hrvWithheld.timingNoiseMs, 0, 1000), noiseShare: num(d.hrvWithheld.noiseShare, 0, 100) } : null,
    rrDetail: d.rrDetail && typeof d.rrDetail === 'object' ? { agree: !!d.rrDetail.agree, purity: num(d.rrDetail.purity, 0, 1), sources: Array.isArray(d.rrDetail.sources) ? d.rrDetail.sources.filter((s) => s && typeof s === 'object').slice(0, 3).map((s) => ({ name: str(s.name, 8), brpm: num(s.brpm, 0, 80), purity: num(s.purity, 0, 1) })) : [] } : null,
  };
  const quality = num(b.quality, 0, 100);
  // Readings queued offline keep their real time (accepted only within the last 7 days, never in the future).
  const tsMs = b.ts ? Date.parse(b.ts) : NaN;
  const ts = Number.isFinite(tsMs) && tsMs <= Date.now() + 60000 && tsMs >= Date.now() - 7 * 86400000 ? new Date(tsMs).toISOString() : undefined;
  return {
    ts,
    source: ['camera', 'manual'].includes(b.source) ? b.source : 'camera',
    hr: num(b.hr, 25, 240), rmssd: num(b.rmssd, 0, 400), sdnn: num(b.sdnn, 0, 400), rr: num(b.rr, 3, 70), stress: num(b.stress, 0, 100),
    quality, snr: num(b.snr, -60, 60), confidence: ['high', 'medium', 'low'].includes(b.confidence) ? b.confidence : quality == null ? null : quality >= 65 ? 'high' : quality >= 40 ? 'medium' : 'low',
    temp_c: num(b.temp_c, 30, 45), spo2: num(b.spo2, 50, 100), bp_sys: num(b.bp_sys, 50, 280), bp_dia: num(b.bp_dia, 25, 180), glucose: num(b.glucose, 15, 900),
    context: Array.isArray(b.context) ? b.context.filter((t) => CONTEXT_TAGS.has(t)) : [],
    voice, detail,
  };
}

function cleanProfile(b) {
  return {
    name: str(b.name, 60) || null,
    age: num(b.age, 0, 120), sex: ['male', 'female', 'other'].includes(b.sex) ? b.sex : null,
    height_cm: num(b.height_cm, 40, 250), weight_kg: num(b.weight_kg, 2, 300),
    conditions: strList(b.conditions, 20, 80), allergies: strList(b.allergies, 20, 80), pregnant: b.pregnant === true,
    language: b.language === 'hi' ? 'hi' : 'en',
    emergency_contact: str(b.emergency_contact, 80) || null,
    city: str(b.city, 60) || null,
  };
}

const SLOTS = new Set(['morning', 'afternoon', 'evening', 'night']);
function cleanMed(b) {
  const times = Array.isArray(b.times) ? [...new Set(b.times.filter((t) => SLOTS.has(t)))] : [];
  const name = str(b.name, 80);
  if (!name) throw new HttpError(400, 'Medicine name is required');
  const given = strList(b.ingredients, 8, 40).map((x) => x.toLowerCase());
  const ingredients = given.length ? given : resolveIngredients(name);
  return { name, dose: str(b.dose, 40) || null, times, ingredients, notes: str(b.notes, 200) || null, active: b.active !== false };
}

/* ---------------- pairing (phone ↔ this computer) ---------------- */

const pairCodes = new Map(); // code -> expiry ms
const attempts = new Map(); // key (ip, or chat sender) -> [timestamps]

function rateLimited(key, max = 20, windowMs = 60000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 5000) for (const [k, l] of attempts) if (!l.length || now - l[l.length - 1] > windowMs) attempts.delete(k);
  return list.length > max;
}

/* ---------------- routes ---------------- */

const routes = [];
const route = (method, pattern, handler, access = 'patient', { limit } = {}) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, access, limit });

route('GET', '/api/health', () => ({ ok: true, version: VERSION, ai: aiStatus().provider }), 'public');
route('GET', '/api/session', ({ req }) => ({ patient: isPatient(req), local: isLoopback(req), https: !!req.socket.encrypted, version: VERSION }), 'public');

route('GET', '/api/meta', () => ({
  version: VERSION,
  symptoms: Object.entries(SYMPTOMS).map(([id, s]) => ({ id, en: s.en, hi: s.hi })),
  chips: COMMON_CHIPS,
  guard: { rules: RULES.length, version: GUARD_VERSION, emergency: RULES.filter((r) => r.level === 'emergency').length, urgent: RULES.filter((r) => r.level === 'urgent').length, soon: RULES.filter((r) => r.level === 'soon').length },
  rules: RULES.map((r) => ({ id: r.id, level: r.level, title: r.title, source: r.source })),
  metrics: TWIN_METRICS,
}));

// Profile
route('GET', '/api/profile', () => ({ profile: db.getProfile(), counts: db.counts() }));
route('PUT', '/api/profile', async ({ body }) => {
  const p = db.saveProfile(cleanProfile(body));
  db.audit('profile.update');
  return { profile: p };
});

// Readings (scans + manual vitals)
route('GET', '/api/readings', ({ url }) => ({ readings: db.listReadings({ days: num(url.searchParams.get('days'), 1, 3650) || 90 }) }));
route('POST', '/api/readings', ({ body }) => {
  const r = cleanReading(body);
  const hasData = ['hr', 'rr', 'temp_c', 'spo2', 'bp_sys', 'glucose'].some((k) => r[k] != null);
  if (!hasData) throw new HttpError(400, 'Nothing to save: no valid vital signs in the request');
  const saved = db.insertReading(r);
  db.audit('reading.add', { id: saved.id, source: saved.source, quality: saved.quality });
  return { reading: saved };
});
route('DELETE', '/api/readings/:id', ({ params }) => {
  if (!db.deleteReading(params.id)) throw new HttpError(404, 'Reading not found');
  db.audit('reading.delete', { id: params.id });
  return { ok: true };
});

// Baseline twin
route('GET', '/api/twin', ({ url }) => twinData(num(url.searchParams.get('days'), 1, 365) || 30));
route('POST', '/api/twin/insights', async ({ body }) => runInsights({ days: num(body.days, 3, 90) || 14, language: body.language === 'hi' ? 'hi' : 'en' }));

// Triage
route('POST', '/api/triage', async ({ body }) => {
  const text = str(body.text, 2000);
  const chips = Array.isArray(body.chips) ? body.chips.filter((c) => SYMPTOMS[c]).slice(0, 30) : [];
  if (!text.trim() && !chips.length) throw new HttpError(400, 'Describe your symptoms or pick at least one.');
  const answers = Array.isArray(body.answers)
    ? body.answers.filter((a) => a && typeof a === 'object').slice(0, 6).map((a) => ({ q: str(a.q, 200), a: str(a.a, 300) })).filter((a) => a.a)
    : [];
  return runTriage({
    text, chips, answers,
    duration_days: num(body.duration_days, 0, 3650), severity: num(body.severity, 0, 10),
    temp_c: num(body.temp_c, 30, 45), spo2: num(body.spo2, 50, 100), bp_sys: num(body.bp_sys, 50, 280), bp_dia: num(body.bp_dia, 25, 180), glucose: num(body.glucose, 15, 900),
    use_scan: body.use_scan !== false, reading_id: str(body.reading_id, 64) || null,
    language: body.language === 'hi' ? 'hi' : 'en',
  });
});
route('GET', '/api/episodes', () => ({ episodes: db.listEpisodes(50).map((e) => ({ id: e.id, ts: e.ts, text: e.text, severity: e.severity, engine: e.engine, headline: e.result && e.result.headline, escalated: e.result && e.result.escalated, rules: (e.guard && e.guard.fired || []).map((f) => f.id) })) }));
route('GET', '/api/episodes/:id', ({ params }) => {
  const ep = db.getEpisode(params.id);
  if (!ep) throw new HttpError(404, 'Episode not found');
  return episodeView(ep);
});

// Medications
route('GET', '/api/meds', () => medsOverview());
route('GET', '/api/meds/resolve', ({ url }) => ({ name: url.searchParams.get('name') || '', ingredients: resolveIngredients(url.searchParams.get('name') || '') }));
route('POST', '/api/meds', ({ body }) => {
  const m = db.insertMed(cleanMed(body));
  db.audit('med.add', { id: m.id, name: m.name });
  return medsOverview();
});
route('POST', '/api/meds/batch', ({ body }) => {
  const list = Array.isArray(body.meds) ? body.meds.filter((m) => m && typeof m === 'object').slice(0, 12) : [];
  if (!list.length) throw new HttpError(400, 'No medicines to add');
  const clean = list.map(cleanMed); // validates all before saving any
  for (const m of clean) {
    const saved = db.insertMed(m);
    db.audit('med.add', { id: saved.id, name: saved.name, source: body.source === 'document' ? 'document' : null });
  }
  return medsOverview();
});
route('PUT', '/api/meds/:id', ({ params, body }) => {
  const cur = db.getMed(params.id);
  if (!cur) throw new HttpError(404, 'Medicine not found');
  db.updateMed(params.id, cleanMed({ ...cur, ...body }));
  return medsOverview();
});
route('DELETE', '/api/meds/:id', ({ params }) => {
  if (!db.deleteMed(params.id)) throw new HttpError(404, 'Medicine not found');
  db.audit('med.delete', { id: params.id });
  return medsOverview();
});
route('POST', '/api/meds/:id/dose', ({ params, body }) => {
  const m = db.getMed(params.id);
  if (!m) throw new HttpError(404, 'Medicine not found');
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : localDayKey();
  if (!SLOTS.has(body.slot)) throw new HttpError(400, 'Unknown dose slot');
  if (body.status === null) db.clearDose(m.id, day, body.slot);
  else db.logDose(m.id, day, body.slot, body.status === 'skipped' ? 'skipped' : 'taken');
  return medsOverview();
});

// Doctor handoff
route('POST', '/api/handoff', async ({ body }) => {
  const out = await createHandoff({ episode_id: body.episode_id || null, hours: num(body.hours, 1, 72) || 24, include_name: body.include_name !== false });
  const base = shareBase();
  const url = `${base.url}/#/doctor/${out.token}`;
  return { ...out, url, local_url: `http://localhost:${PORT}/#/doctor/${out.token}`, lan: base.lan, qr_svg: await qrSvg(url) };
});
route('GET', '/api/handoffs', () => ({ handoffs: db.listHandoffs() }));
route('DELETE', '/api/handoff/:token', ({ params }) => {
  if (!db.revokeHandoff(params.token)) throw new HttpError(404, 'Link not found');
  chat.closeChannel(params.token, 'revoked');
  db.audit('handoff.revoke', { token: params.token.slice(0, 4) + '…' });
  return { ok: true };
});
route('GET', '/api/handoff/:token', ({ params }) => {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(params.token)) throw new HttpError(404, 'This link does not exist.');
  const r = readHandoff(params.token);
  if (r.status !== 200) throw new HttpError(r.status, r.error);
  return r.data;
}, 'public');
route('POST', '/api/handoff/:token/note', ({ params, body }) => {
  const h = /^[A-Za-z0-9_-]{10,40}$/.test(params.token) ? db.getHandoff(params.token) : null;
  if (!h || h.revoked || Date.parse(h.expires_at) < Date.now()) throw new HttpError(410, 'This link is no longer active.');
  const note = str(body.note, 2000);
  if (!note) throw new HttpError(400, 'Note is empty');
  const author = str(body.author, 80);
  db.setClinicianNote(params.token, author ? `${note}\n— ${author}` : note);
  db.audit('handoff.note', { token: params.token.slice(0, 4) + '…' });
  return { ok: true };
}, 'public');

// Live consultation: a chat thread on each doctor link, pushed to both sides over Server-Sent Events.
const TOKEN_RE = /^[A-Za-z0-9_-]{10,40}$/;
function activeLink(token) {
  const h = TOKEN_RE.test(token) ? db.getHandoff(token) : null;
  if (!h) throw new HttpError(404, 'This link does not exist.');
  if (h.revoked) throw new HttpError(410, 'The patient revoked this link.');
  if (Date.parse(h.expires_at) < Date.now()) throw new HttpError(410, 'This link has expired.');
  return h;
}
const lastEventId = (req) => Math.max(0, parseInt(req.headers['last-event-id'], 10) || 0);
function chatPost(token, sender, msg) {
  if (rateLimited(`chat:${token}:${sender}`, 20)) throw new HttpError(429, 'Messages are being sent too quickly. Wait a moment.');
  if (db.countMessages(token) >= chat.MAX_MESSAGES) throw new HttpError(429, 'This conversation is full. Create a new doctor link to continue.');
  const message = chat.postMessage(token, { sender, ...msg });
  db.audit('chat.message', { token: token.slice(0, 4) + '…', sender, kind: message.kind });
  return { message };
}

route('GET', '/api/consult/:token', async ({ params }) => {
  const v = TOKEN_RE.test(params.token) ? consultView(params.token) : null;
  if (!v) throw new HttpError(404, 'Consultation not found');
  const base = shareBase();
  const url = `${base.url}/#/doctor/${params.token}`;
  return { ...v, url, local_url: `http://localhost:${PORT}/#/doctor/${params.token}`, lan: base.lan, qr_svg: v.active ? await qrSvg(url) : null, presence: chat.presence(params.token) };
});
route('GET', '/api/consult/:token/stream', ({ req, res, params }) => {
  activeLink(params.token);
  chat.openStream({ req, res, token: params.token, role: 'patient', headers: SECURITY_HEADERS, lastId: lastEventId(req) });
});
route('POST', '/api/consult/:token/messages', ({ params, body }) => {
  activeLink(params.token);
  if (body.kind === 'vitals') {
    const v = vitalsMessage();
    if (!v) throw new HttpError(400, 'No readings in the last 24 hours. Do a scan first.');
    return chatPost(params.token, 'patient', { kind: 'vitals', body: v.body, meta: v.meta });
  }
  const text = str(body.body, 1000);
  if (!text) throw new HttpError(400, 'Message is empty');
  return chatPost(params.token, 'patient', { kind: 'text', body: text });
});
route('POST', '/api/consult/:token/typing', ({ params }) => {
  activeLink(params.token);
  if (!rateLimited(`typing:${params.token}:patient`, 40)) chat.typing(params.token, 'patient');
  return { ok: true };
});
route('GET', '/api/handoff/:token/stream', ({ req, res, params }) => {
  activeLink(params.token);
  if (rateLimited(`stream:${req.socket.remoteAddress}`, 30)) throw new HttpError(429, 'Too many connections. Wait a minute.');
  chat.openStream({ req, res, token: params.token, role: 'doctor', headers: SECURITY_HEADERS, lastId: lastEventId(req) });
}, 'public');
route('POST', '/api/handoff/:token/messages', ({ req, params, body }) => {
  activeLink(params.token);
  if (rateLimited(`chatip:${req.socket.remoteAddress}`, 40)) throw new HttpError(429, 'Messages are being sent too quickly. Wait a moment.');
  const author = str(body.author, 60) || null;
  if (body.kind === 'scan_request') {
    return chatPost(params.token, 'doctor', { kind: 'scan_request', author, body: str(body.body, 300) || 'Please do a fresh 60-second scan and share the result here.' });
  }
  const text = str(body.body, 1000);
  if (!text) throw new HttpError(400, 'Message is empty');
  return chatPost(params.token, 'doctor', { kind: 'text', author, body: text });
}, 'public');
route('POST', '/api/handoff/:token/typing', ({ params }) => {
  activeLink(params.token);
  if (!rateLimited(`typing:${params.token}:doctor`, 40)) chat.typing(params.token, 'doctor');
  return { ok: true };
}, 'public');

// Prescription / lab report reader: the photo is read by Gemini and never stored.
const DOC_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
function magicOk(bytes, mime) {
  const at = (i, s) => bytes.subarray(i, i + s.length).toString('latin1') === s;
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === 'image/png') return at(1, 'PNG');
  if (mime === 'image/webp') return at(0, 'RIFF') && at(8, 'WEBP');
  return at(0, '%PDF');
}
route('POST', '/api/documents/read', async ({ req, body }) => {
  if (rateLimited(`doc:${req.socket.remoteAddress}`, 10)) throw new HttpError(429, 'Too many documents in a minute. Wait a moment.');
  let data = typeof body.data === 'string' ? body.data : '';
  let mime = str(body.mime, 40).toLowerCase();
  const prefix = data.match(/^data:([\w/+.-]+);base64,/);
  if (prefix) { mime = mime || prefix[1].toLowerCase(); data = data.slice(prefix[0].length); }
  if (!DOC_MIME.has(mime)) throw new HttpError(400, 'Use a JPG, PNG or WebP photo, or a PDF.');
  if (data.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, 'The file could not be read.');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 7_000_000) throw new HttpError(413, 'The file is too large (7 MB maximum).');
  if (!magicOk(bytes, mime)) throw new HttpError(400, 'The file does not match its type. Use a JPG, PNG or WebP photo, or a PDF.');
  return readDocument({ data, mimeType: mime, language: body.language === 'hi' ? 'hi' : 'en' });
}, 'patient', { limit: 10_000_000 });

// AI configuration
route('GET', '/api/ai/status', () => aiStatus());
route('POST', '/api/ai/test', async () => {
  try { return { ok: true, ...(await testGemini()), status: aiStatus() }; }
  catch (e) { return { ok: false, error: describeAiError(e), status: aiStatus() }; }
});
route('POST', '/api/ai/key', async ({ body }) => {
  const key = str(body.key, 200);
  if (key && !/^[A-Za-z0-9_\-.]{20,200}$/.test(key)) throw new HttpError(400, 'That does not look like an API key.');
  const previous = process.env.GEMINI_API_KEY || '';
  setGeminiKey(key || null);
  let test = null;
  if (key) {
    try { test = { ok: true, ...(await testGemini()) }; }
    catch (e) {
      test = { ok: false, error: describeAiError(e) };
      if (test.error.kind === 'auth') { setGeminiKey(previous || null); throw new HttpError(400, test.error.message); }
    }
  }
  process.env.GEMINI_API_KEY = key;
  // Persist to .env (gitignored) so the key survives restarts.
  let env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  env = /^GEMINI_API_KEY=.*$/m.test(env) ? env.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${key}`) : `${env}${env && !env.endsWith('\n') ? '\n' : ''}GEMINI_API_KEY=${key}\n`;
  writeFileSync(ENV_FILE, env);
  db.audit('ai.key', { set: !!key });
  return { ok: true, test, status: aiStatus() };
}, 'local');

// Phone pairing
route('POST', '/api/pair/start', async () => {
  const code = randomBytes(9).toString('base64url');
  pairCodes.set(code, Date.now() + 10 * 60000);
  const base = shareBase();
  const url = `${base.url}/#/pair/${code}`;
  return { code, url, https: base.https, lan: base.lan, expires_in: 600, qr_svg: await qrSvg(url) };
}, 'local');
route('POST', '/api/pair/claim', ({ req, body, res }) => {
  if (rateLimited(req.socket.remoteAddress)) throw new HttpError(429, 'Too many attempts — wait a minute.');
  const code = str(body.code, 40);
  const exp = pairCodes.get(code);
  if (!exp || exp < Date.now()) throw new HttpError(400, 'This pairing code is invalid or expired. Generate a new one on your computer.');
  pairCodes.delete(code);
  const token = randomBytes(24).toString('base64url');
  const ua = String(req.headers['user-agent'] || '');
  const name = str(body.name, 40) || (/iphone|ipad/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android phone' : 'Browser');
  db.addDevice(token, name);
  db.audit('device.pair', { name });
  const secure = req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `nadi_device=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}`);
  return { ok: true, name };
}, 'public');
route('GET', '/api/devices', () => ({ devices: db.listDevices() }), 'local');
route('DELETE', '/api/devices/:id', ({ params }) => {
  if (!db.removeDevice(params.id)) throw new HttpError(404, 'Device not found');
  db.audit('device.remove', { id: params.id });
  return { ok: true };
}, 'local');

// Data rights & demo
route('GET', '/api/audit', () => ({ audit: db.listAudit(200) }));
route('GET', '/api/export', ({ res }) => {
  db.audit('data.export');
  res.setHeader('Content-Disposition', `attachment; filename="nadi-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return db.exportAll();
});
route('DELETE', '/api/data', () => { db.wipeAll({ keepDevices: false }); db.audit('data.erase'); return { ok: true }; }, 'local');
route('POST', '/api/demo/seed', () => ({ ok: true, counts: seedDemo() }));

/* ---------------- static files ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) { res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden'); }
  let st = existsSync(file) ? statSync(file) : null;
  if (!st || st.isDirectory()) {
    if (path.extname(rel)) { res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    file = path.join(PUBLIC, 'index.html'); // SPA fallback
    st = statSync(file);
  }
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  };
  if (file.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

/* ---------------- dispatcher ---------------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
    return serveStatic(req, res, pathname);
  }
  const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
  if (!r) return send(res, 404, { error: 'Unknown API route' });
  try {
    if (r.access === 'local' && !isLoopback(req)) throw new HttpError(403, 'This action is only allowed on the computer running Nadi.');
    if (r.access === 'patient' && !isPatient(req)) throw new HttpError(401, 'This device is not paired. Open Settings → "Use on your phone" on the computer running Nadi.');
    // Basic CSRF defence for state-changing requests from browsers: same-origin only.
    if (req.method !== 'GET' && req.headers.origin) {
      let originHost = null;
      try { originHost = new URL(req.headers.origin).host; } catch { /* "null" (sandboxed/file pages) or malformed */ }
      if (!originHost || originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
    }
    const params = r.re.exec(pathname).groups || {};
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req, r.limit) : {};
    const out = await r.handler({ req, res, url, params, body });
    if (res.headersSent) return; // the handler streams its own response (Server-Sent Events)
    send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[nadi] ${req.method} ${pathname}:`, e);
    if (res.headersSent) { res.end(); return; }
    send(res, status, { error: status >= 500 ? 'Something went wrong on the server.' : e.message });
  }
}

/* ---------------- start ---------------- */

const onError = (label) => (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ${label} port is already in use. Close the other Nadi window or set ${label === 'HTTPS' ? 'HTTPS_PORT' : 'PORT'}=xxxx.\n`);
  else console.error(e);
  process.exit(1);
};

const server = http.createServer(handle);
server.on('error', onError('HTTP'));
server.listen(PORT, '0.0.0.0', async () => {
  let httpsLine = '';
  if (HAS_CERTS) {
    const s = https.createServer({ key: readFileSync(path.join(CERT_DIR, 'key.pem')), cert: readFileSync(path.join(CERT_DIR, 'cert.pem')) }, handle);
    s.on('error', onError('HTTPS'));
    s.listen(HTTPS_PORT, '0.0.0.0');
    httpsLine = lanAddresses().map((ip) => `  Phone:    https://${ip}:${HTTPS_PORT}   (camera works over HTTPS)\n`).slice(0, 1).join('');
  }
  const ai = aiStatus();
  const lan = lanAddresses()[0];
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │  NADI  ·  contactless vitals + AI triage   v${VERSION.padEnd(13)}│
  └──────────────────────────────────────────────────────────┘
  Open:     http://localhost:${PORT}
${lan ? `  Network:  http://${lan}:${PORT}   (doctor links)\n` : ''}${httpsLine || (lan ? `  Phone:    run "npm run certs" once for HTTPS so phone cameras work\n` : '')}  AI:       ${ai.provider === 'gemini' ? `Gemini (key ${ai.key}) — model chosen on first use` : 'offline clinical engine (add a Gemini key in Settings)'}
  Safety:   ${RULES.length} guardrail rules (${GUARD_VERSION})
  Data:     ${path.relative(ROOT, db.DB_PATH) || db.DB_PATH} — stays on this computer
`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
// A demo server must not die on one bad request: log anything that escapes a handler and keep serving.
process.on('unhandledRejection', (e) => console.error('[nadi] unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('[nadi] uncaught exception:', e));
