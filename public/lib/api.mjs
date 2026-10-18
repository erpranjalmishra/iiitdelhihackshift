// JSON API client with an offline queue for readings (e.g. a phone that drops Wi-Fi mid-scan).
const QUEUE_KEY = 'nadi.queue';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Nadi server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data;
}

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } };

/** Save a reading; if the server is unreachable, keep it locally and sync later. */
export async function saveReading(reading) {
  try {
    return { saved: true, ...(await api('/api/readings', { method: 'POST', body: reading })) };
  } catch (e) {
    if (e.status !== 0) throw e;
    const q = readQueue();
    q.push({ ...reading, ts: new Date().toISOString(), queued: true });
    writeQueue(q);
    return { saved: false, queued: true };
  }
}

export async function flushQueue() {
  const q = readQueue();
  if (!q.length) return 0;
  const left = [];
  let sent = 0;
  for (const r of q) {
    try { await api('/api/readings', { method: 'POST', body: r }); sent++; } catch (e) { if (e.status === 0) left.push(r); }
  }
  writeQueue(left);
  return sent;
}

export const queuedCount = () => readQueue().length;
