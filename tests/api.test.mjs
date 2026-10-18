// HTTP API tests against a real server process (throwaway database, offline AI so no quota is used).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 39000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(os.tmpdir(), 'nadi-test-'));
let proc;

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(PORT + 1), NADI_DB: path.join(dir, 'test.db'), NADI_AI: 'offline' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  proc.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* file may still be locked on Windows */ }
});

async function call(method, p, { body, raw, headers = {} } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

test('malformed and hostile input gets a 4xx, never a 5xx', async () => {
  const cases = [
    ['POST', '/api/triage', { raw: '{"text": ' }],
    ['POST', '/api/triage', { body: { text: 'fever', answers: [null, 5, { q: null, a: null }] } }],
    ['POST', '/api/triage', { body: { text: { nested: true } } }],
    ['POST', '/api/readings', { body: { hr: 70, detail: { waveform: ['a', null], spectrum: [null], rrDetail: { sources: [null, 1] } } } }],
    ['PUT', '/api/profile', { raw: 'null' }],
    ['PUT', '/api/profile', { raw: '"just a string"' }],
    ['POST', '/api/meds', { body: { name: { a: 1 } } }],
    ['POST', '/api/meds/unknown/dose', { body: { slot: 'morning' } }],
    ['GET', '/api/handoff/..%2F..%2Fetc', {}],
    ['POST', '/api/pair/claim', { body: { code: { $gt: '' } } }],
  ];
  for (const [m, p, opts] of cases) {
    const r = await call(m, p, opts);
    assert.ok(r.status >= 200 && r.status < 500, `${m} ${p} ${JSON.stringify(opts).slice(0, 80)} → ${r.status}`);
  }
  assert.equal((await call('GET', '/api/health')).status, 200, 'server still alive');
});

test('a non-object body cannot wipe the profile', async () => {
  await call('PUT', '/api/profile', { body: { name: 'Asha', age: 41, conditions: ['Asthma'] } });
  assert.equal((await call('PUT', '/api/profile', { raw: '[1,2,3]' })).status, 400);
  const p = (await call('GET', '/api/profile')).json.profile;
  assert.equal(p.name, 'Asha');
  assert.deepEqual(p.conditions, ['Asthma']);
});

test('objects are never stored as "[object Object]"', async () => {
  assert.equal((await call('POST', '/api/meds', { body: { name: { evil: 1 } } })).status, 400);
  await call('PUT', '/api/profile', { body: { name: { evil: 1 }, age: 41 } });
  assert.notEqual((await call('GET', '/api/profile')).json.profile.name, '[object Object]');
});

test('oversized bodies get a clean 413', async () => {
  const r = await call('POST', '/api/readings', { raw: JSON.stringify({ hr: 70, pad: 'y'.repeat(2_100_000) }) });
  assert.equal(r.status, 413);
});

test('cross-origin writes are refused, including Origin: null', async () => {
  for (const origin of ['https://evil.example', 'null', '::::']) {
    assert.equal((await call('POST', '/api/meds', { body: { name: 'x' }, headers: { Origin: origin } })).status, 403, origin);
  }
  assert.equal((await call('POST', '/api/meds', { body: { name: 'Crocin', times: ['night'] }, headers: { Origin: `http://127.0.0.1:${PORT}` } })).status, 200);
});

test('triage end to end (offline engine) with the demo story', async () => {
  assert.equal((await call('POST', '/api/demo/seed')).status, 200);
  const r = (await call('POST', '/api/triage', { body: { text: 'kal se bukhar hai 101, badan dard aur aankhon ke peeche dard' } })).json;
  assert.equal(r.engine, 'offline');
  assert.equal(r.severity, 'soon');
  assert.ok(r.guard.fired.some((f) => f.id === 'TWIN-DEVIATION'), 'baseline twin flagged the drift');
  assert.match(r.result.possible_conditions[0].name, /dengue/i);
  assert.ok(r.medFindings.some((f) => f.id === 'DUP-PCM'), 'duplicate paracetamol caught');
  const e = (await call('POST', '/api/triage', { body: { text: 'seene mein dard, baayein haath tak ja raha hai, paseena', use_scan: false } })).json;
  assert.equal(e.severity, 'emergency');
});

test('doctor handoff lifecycle: create → view (counted) → note → revoke → gone', async () => {
  const h = (await call('POST', '/api/handoff', { body: {} })).json;
  assert.ok(h.token && h.qr_svg.startsWith('<svg'));
  const v = await call('GET', `/api/handoff/${h.token}`);
  assert.equal(v.status, 200);
  assert.equal(v.json.views, 1);
  assert.ok(v.json.soap.one_liner);
  assert.equal((await call('POST', `/api/handoff/${h.token}/note`, { body: { note: 'CBC today', author: 'Dr. M' } })).status, 200);
  assert.equal((await call('DELETE', `/api/handoff/${h.token}`)).status, 200);
  assert.equal((await call('GET', `/api/handoff/${h.token}`)).status, 410);
});

test('every triage result says which doctor to see; safety rules pick the specialty', async () => {
  const e = (await call('POST', '/api/triage', { body: { text: 'chest pain spreading to left arm with sweating', use_scan: false } })).json;
  assert.equal(e.referral.id, 'cardiologist');
  assert.equal(e.referral.emergency, true);
  const s = (await call('POST', '/api/triage', { body: { text: 'red itchy eyes with sticky discharge since yesterday', use_scan: false } })).json;
  assert.ok(s.referral && s.referral.name && s.referral.maps_url.startsWith('https://www.google.com/maps/search/'));
  const again = (await call('GET', `/api/episodes/${s.episode_id}`)).json;
  assert.equal(again.referral.id, s.referral.id, 'stored with the episode');
});

async function readUntil(reader, state, re, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!re.test(state.buf)) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`timed out waiting for ${re}`);
    const r = await Promise.race([reader.read(), new Promise((res) => setTimeout(() => res({ timeout: true }), left))]);
    if (r.timeout) continue;
    if (r.done) break;
    state.buf += state.dec.decode(r.value, { stream: true });
  }
  return state.buf;
}

test('live consultation: messages reach the doctor stream; revoking the link ends the chat', async () => {
  const h = (await call('POST', '/api/handoff', { body: {} })).json;
  const c = (await call('GET', `/api/consult/${h.token}`)).json;
  assert.equal(c.active, true);
  assert.ok(c.qr_svg.startsWith('<svg'));
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/handoff/${h.token}/stream`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const st = { buf: '', dec: new TextDecoder() };
  await readUntil(reader, st, /"doctor":true/);
  assert.equal((await call('GET', `/api/consult/${h.token}`)).json.presence.doctor, true, 'patient sees the doctor online');
  assert.equal((await call('POST', `/api/consult/${h.token}/messages`, { body: { body: 'Fever since yesterday' } })).status, 200);
  await readUntil(reader, st, /Fever since yesterday/);
  const d = await call('POST', `/api/handoff/${h.token}/messages`, { body: { body: 'Please check your temperature', author: 'Dr. M' } });
  assert.equal(d.status, 200);
  assert.equal(d.json.message.sender, 'doctor');
  assert.equal((await call('POST', `/api/handoff/${h.token}/messages`, { body: { kind: 'scan_request', author: 'Dr. M' } })).json.message.kind, 'scan_request');
  const v = await call('POST', `/api/consult/${h.token}/messages`, { body: { kind: 'vitals' } });
  assert.equal(v.json.message.kind, 'vitals', 'the demo story has a reading from today');
  assert.ok(v.json.message.meta.hr > 0);
  assert.equal((await call('POST', `/api/handoff/${h.token}/messages`, { body: { body: '   ' } })).status, 400);
  const thread = (await call('GET', `/api/consult/${h.token}`)).json.messages;
  assert.deepEqual(thread.map((m) => m.sender), ['patient', 'doctor', 'doctor', 'patient']);
  assert.equal((await call('GET', '/api/handoffs')).json.handoffs.find((x) => x.token === h.token).messages, 4);
  assert.equal((await call('DELETE', `/api/handoff/${h.token}`)).status, 200);
  await readUntil(reader, st, /event: closed/);
  ctrl.abort();
  assert.equal((await call('POST', `/api/handoff/${h.token}/messages`, { body: { body: 'still there?' } })).status, 410);
  assert.equal((await fetch(`${BASE}/api/handoff/${h.token}/stream`)).status, 410);
});

test('document reader validates uploads and says plainly when it needs Gemini', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300)]).toString('base64');
  const r = await call('POST', '/api/documents/read', { body: { data: `data:image/jpeg;base64,${jpeg}` } });
  assert.equal(r.status, 200);
  assert.equal(r.json.needs_ai, true);
  assert.equal((await call('POST', '/api/documents/read', { body: { data: jpeg, mime: 'image/gif' } })).status, 400);
  const notPng = Buffer.from('not really a png '.repeat(20)).toString('base64');
  assert.equal((await call('POST', '/api/documents/read', { body: { data: notPng, mime: 'image/png' } })).status, 400);
  assert.equal((await call('POST', '/api/documents/read', { body: { data: 'A'.repeat(9_400_000), mime: 'image/jpeg' } })).status, 413);
});

test('medicines read from a prescription are added in one validated batch', async () => {
  const before = (await call('GET', '/api/meds')).json.meds.length;
  assert.equal((await call('POST', '/api/meds/batch', { body: { meds: [{ name: 'Pan 40', times: ['morning'] }, { name: '' }] } })).status, 400);
  assert.equal((await call('GET', '/api/meds')).json.meds.length, before, 'nothing saved when one entry is invalid');
  const ok = await call('POST', '/api/meds/batch', { body: { meds: [{ name: 'Pan 40', times: ['morning'] }, { name: 'Azithral 500', times: ['morning'] }], source: 'document' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.meds.length, before + 2);
});
