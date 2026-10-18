// Persistence: Node's built-in SQLite (node:sqlite) — a real database file, no native build step.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { localDayKey } from './clinical/meds.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.NADI_DATA_DIR || path.join(here, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = process.env.NADI_DB || path.join(DATA_DIR, 'nadi.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT, age INTEGER, sex TEXT, height_cm REAL, weight_kg REAL,
  conditions TEXT NOT NULL DEFAULT '[]', allergies TEXT NOT NULL DEFAULT '[]',
  pregnant INTEGER NOT NULL DEFAULT 0, language TEXT NOT NULL DEFAULT 'en',
  emergency_contact TEXT, city TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'camera',
  hr REAL, rmssd REAL, sdnn REAL, rr REAL, stress REAL,
  quality REAL, snr REAL, confidence TEXT,
  temp_c REAL, spo2 REAL, bp_sys REAL, bp_dia REAL, glucose REAL,
  voice TEXT, detail TEXT, context TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, text TEXT, intake TEXT NOT NULL,
  reading_id TEXT, result TEXT NOT NULL, guard TEXT NOT NULL,
  severity TEXT NOT NULL, engine TEXT NOT NULL, model TEXT, latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS episodes_ts ON episodes(ts);
CREATE TABLE IF NOT EXISTS meds (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, dose TEXT, times TEXT NOT NULL DEFAULT '[]',
  ingredients TEXT NOT NULL DEFAULT '[]', notes TEXT, start_date TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS med_logs (
  id TEXT PRIMARY KEY, med_id TEXT NOT NULL REFERENCES meds(id) ON DELETE CASCADE,
  day TEXT NOT NULL, slot TEXT NOT NULL, status TEXT NOT NULL, ts TEXT NOT NULL,
  UNIQUE (med_id, day, slot)
);
CREATE TABLE IF NOT EXISTS handoffs (
  token TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  episode_id TEXT, payload TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0, clinician_note TEXT, note_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, ts TEXT NOT NULL,
  sender TEXT NOT NULL, author TEXT, kind TEXT NOT NULL DEFAULT 'text', body TEXT NOT NULL, meta TEXT
);
CREATE INDEX IF NOT EXISTS messages_token ON messages(token, id);
CREATE TABLE IF NOT EXISTS devices (
  token TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL, last_seen TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, event TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
const J = (v) => JSON.stringify(v ?? null);
const P = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

/* ---------- profile ---------- */

export function getProfile() {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  if (!row) return null;
  return { ...row, conditions: P(row.conditions, []), allergies: P(row.allergies, []), pregnant: !!row.pregnant };
}

export function saveProfile(p) {
  const cur = getProfile() || {};
  const m = { ...cur, ...p };
  db.prepare(`INSERT INTO profile (id, name, age, sex, height_cm, weight_kg, conditions, allergies, pregnant, language, emergency_contact, city, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, age=excluded.age, sex=excluded.sex, height_cm=excluded.height_cm,
      weight_kg=excluded.weight_kg, conditions=excluded.conditions, allergies=excluded.allergies, pregnant=excluded.pregnant,
      language=excluded.language, emergency_contact=excluded.emergency_contact, city=excluded.city, updated_at=excluded.updated_at`)
    .run(m.name ?? null, m.age ?? null, m.sex ?? null, m.height_cm ?? null, m.weight_kg ?? null,
      J(m.conditions || []), J(m.allergies || []), m.pregnant ? 1 : 0, m.language || 'en',
      m.emergency_contact ?? null, m.city ?? null, now());
  return getProfile();
}

/* ---------- readings (camera scans + manual vitals) ---------- */

const READING_COLS = ['hr', 'rmssd', 'sdnn', 'rr', 'stress', 'quality', 'snr', 'temp_c', 'spo2', 'bp_sys', 'bp_dia', 'glucose'];

function readingOut(row) {
  if (!row) return null;
  return { ...row, voice: P(row.voice, null), detail: P(row.detail, null), context: P(row.context, []) };
}

export function insertReading(r) {
  const id = r.id || uid();
  const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
  db.prepare(`INSERT INTO readings (id, ts, source, ${READING_COLS.join(', ')}, confidence, voice, detail, context)
    VALUES (?, ?, ?, ${READING_COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`)
    .run(id, r.ts || now(), r.source || 'camera', ...READING_COLS.map((c) => num(r[c])),
      r.confidence ?? null, r.voice ? J(r.voice) : null, r.detail ? J(r.detail) : null, J(r.context || []));
  return getReading(id);
}

export const getReading = (id) => readingOut(db.prepare('SELECT * FROM readings WHERE id = ?').get(id));

export function listReadings({ days = 90, limit = 2000 } = {}) {
  return db.prepare('SELECT * FROM readings WHERE ts >= ? ORDER BY ts ASC LIMIT ?').all(daysAgo(days), limit).map(readingOut);
}

export function latestReading({ withinHours = null, source = null } = {}) {
  const where = [], args = [];
  if (withinHours != null) { where.push('ts >= ?'); args.push(new Date(Date.now() - withinHours * 3600000).toISOString()); }
  if (source) { where.push('source = ?'); args.push(source); }
  return readingOut(db.prepare(`SELECT * FROM readings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT 1`).get(...args));
}

export const deleteReading = (id) => db.prepare('DELETE FROM readings WHERE id = ?').run(id).changes > 0;

/* ---------- triage episodes ---------- */

function episodeOut(row) {
  if (!row) return null;
  return { ...row, intake: P(row.intake, {}), result: P(row.result, {}), guard: P(row.guard, {}) };
}

export function insertEpisode(e) {
  const id = e.id || uid();
  db.prepare(`INSERT INTO episodes (id, ts, text, intake, reading_id, result, guard, severity, engine, model, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, e.ts || now(), e.text ?? null, J(e.intake), e.reading_id ?? null, J(e.result), J(e.guard),
      e.severity, e.engine, e.model ?? null, e.latency_ms ?? null);
  return getEpisode(id);
}

export const getEpisode = (id) => episodeOut(db.prepare('SELECT * FROM episodes WHERE id = ?').get(id));
export const listEpisodes = (limit = 50) => db.prepare('SELECT * FROM episodes ORDER BY ts DESC LIMIT ?').all(limit).map(episodeOut);

/* ---------- medications ---------- */

function medOut(row) {
  return row && { ...row, times: P(row.times, []), ingredients: P(row.ingredients, []), active: !!row.active };
}

export function insertMed(m) {
  const id = m.id || uid();
  db.prepare(`INSERT INTO meds (id, name, dose, times, ingredients, notes, start_date, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.name, m.dose ?? null, J(m.times || []), J(m.ingredients || []), m.notes ?? null,
      m.start_date || localDayKey(), m.active === false ? 0 : 1, m.created_at || now());
  return getMed(id);
}

export function updateMed(id, m) {
  const cur = getMed(id);
  if (!cur) return null;
  const n = { ...cur, ...m };
  db.prepare('UPDATE meds SET name=?, dose=?, times=?, ingredients=?, notes=?, active=? WHERE id=?')
    .run(n.name, n.dose ?? null, J(n.times || []), J(n.ingredients || []), n.notes ?? null, n.active ? 1 : 0, id);
  return getMed(id);
}

export const getMed = (id) => medOut(db.prepare('SELECT * FROM meds WHERE id = ?').get(id));
export const listMeds = () => db.prepare('SELECT * FROM meds ORDER BY active DESC, created_at ASC').all().map(medOut);
export const deleteMed = (id) => db.prepare('DELETE FROM meds WHERE id = ?').run(id).changes > 0;

export function logDose(medId, day, slot, status) {
  db.prepare(`INSERT INTO med_logs (id, med_id, day, slot, status, ts) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(med_id, day, slot) DO UPDATE SET status=excluded.status, ts=excluded.ts`)
    .run(uid(), medId, day, slot, status, now());
}

export function clearDose(medId, day, slot) {
  db.prepare('DELETE FROM med_logs WHERE med_id = ? AND day = ? AND slot = ?').run(medId, day, slot);
}

export const medLogs = (sinceDay) => db.prepare('SELECT * FROM med_logs WHERE day >= ? ORDER BY day ASC').all(sinceDay);

/* ---------- handoffs (time-limited doctor links) ---------- */

function handoffOut(row) {
  return row && { ...row, payload: P(row.payload, {}), revoked: !!row.revoked };
}

export function insertHandoff(h) {
  db.prepare('INSERT INTO handoffs (token, created_at, expires_at, episode_id, payload) VALUES (?, ?, ?, ?, ?)')
    .run(h.token, now(), h.expires_at, h.episode_id ?? null, J(h.payload));
  return getHandoff(h.token);
}

export const getHandoff = (token) => handoffOut(db.prepare('SELECT * FROM handoffs WHERE token = ?').get(token));
export const listHandoffs = () => db.prepare(`SELECT token, created_at, expires_at, episode_id, views, revoked, clinician_note, note_at,
    (SELECT COUNT(*) FROM messages m WHERE m.token = handoffs.token) AS messages,
    (SELECT MAX(ts) FROM messages m WHERE m.token = handoffs.token AND m.sender = 'doctor') AS doctor_last_at
  FROM handoffs ORDER BY created_at DESC LIMIT 20`).all()
  .map((r) => ({ ...r, revoked: !!r.revoked }));
export const countHandoffView = (token) => db.prepare('UPDATE handoffs SET views = views + 1 WHERE token = ?').run(token);
export const revokeHandoff = (token) => db.prepare('UPDATE handoffs SET revoked = 1 WHERE token = ?').run(token).changes > 0;
export const setClinicianNote = (token, note) =>
  db.prepare('UPDATE handoffs SET clinician_note = ?, note_at = ? WHERE token = ?').run(note, now(), token);

/* ---------- consultation chat (one thread per doctor link) ---------- */

const messageOut = (row) => row && { ...row, meta: P(row.meta, null) };

export function insertMessage(m) {
  const r = db.prepare('INSERT INTO messages (token, ts, sender, author, kind, body, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(m.token, now(), m.sender, m.author ?? null, m.kind || 'text', m.body, m.meta ? J(m.meta) : null);
  return getMessage(Number(r.lastInsertRowid));
}
export const getMessage = (id) => messageOut(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
export const listMessages = (token, after = 0, limit = 500) =>
  db.prepare('SELECT * FROM messages WHERE token = ? AND id > ? ORDER BY id ASC LIMIT ?').all(token, after, limit).map(messageOut);
export const countMessages = (token) => db.prepare('SELECT COUNT(*) AS n FROM messages WHERE token = ?').get(token).n;

/* ---------- paired devices ---------- */

export const addDevice = (token, name) => db.prepare('INSERT INTO devices (token, name, created_at, last_seen) VALUES (?, ?, ?, ?)').run(token, name, now(), now());
export function touchDevice(token) {
  return db.prepare('UPDATE devices SET last_seen = ? WHERE token = ?').run(now(), token).changes > 0;
}
export const listDevices = () => db.prepare('SELECT substr(token, 1, 6) AS id, name, created_at, last_seen FROM devices ORDER BY created_at DESC').all();
export const removeDevice = (prefix) => db.prepare('DELETE FROM devices WHERE substr(token, 1, 6) = ?').run(prefix).changes > 0;

/* ---------- audit log & settings ---------- */

export function audit(event, detail = null) {
  db.prepare('INSERT INTO audit (ts, event, detail) VALUES (?, ?, ?)').run(now(), event, detail == null ? null : J(detail));
}
export const listAudit = (limit = 100) => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r, detail: P(r.detail, null) }));

export const getSetting = (key, fallback = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? P(row.value, fallback) : fallback;
};
export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, J(value));

/* ---------- data rights: export & erase ---------- */

export function exportAll() {
  return {
    exported_at: now(),
    profile: getProfile(),
    readings: db.prepare('SELECT * FROM readings ORDER BY ts').all().map(readingOut),
    episodes: db.prepare('SELECT * FROM episodes ORDER BY ts').all().map(episodeOut),
    meds: listMeds(),
    med_logs: db.prepare('SELECT * FROM med_logs ORDER BY day').all(),
    handoffs: listHandoffs(),
    messages: db.prepare('SELECT * FROM messages ORDER BY id').all().map(messageOut),
    audit: listAudit(1000),
  };
}

export function wipeAll({ keepDevices = true } = {}) {
  db.exec(`DELETE FROM med_logs; DELETE FROM meds; DELETE FROM readings; DELETE FROM episodes;
    DELETE FROM messages; DELETE FROM handoffs; DELETE FROM profile; DELETE FROM audit; ${keepDevices ? '' : 'DELETE FROM devices;'}`);
}

export function counts() {
  const c = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return { readings: c('readings'), episodes: c('episodes'), meds: c('meds'), handoffs: c('handoffs') };
}
