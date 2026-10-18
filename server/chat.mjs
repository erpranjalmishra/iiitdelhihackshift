/**
 * Live consultation on a doctor link. Messages are stored with the link and
 * pushed to both sides over Server-Sent Events, together with presence
 * ("doctor online") and typing hints. Streams close by themselves when the
 * link expires or the patient revokes it.
 */
import * as db from './db.mjs';

const channels = new Map(); // token -> Set<{ res, role }>
const HEARTBEAT_MS = 20000;
export const MAX_MESSAGES = 1000;

export const publicMessage = (m) => ({ id: m.id, ts: m.ts, sender: m.sender, author: m.author, kind: m.kind, body: m.body, meta: m.meta });

function write(client, event, data, id) {
  try {
    client.res.write(`${id != null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* socket already gone: the close handler cleans up */ }
}

function broadcast(token, event, data, id) {
  for (const c of channels.get(token) || []) write(c, event, data, id);
}

export function presence(token) {
  const roles = [...(channels.get(token) || [])].map((c) => c.role);
  return { doctor: roles.includes('doctor'), patient: roles.includes('patient') };
}

/** Hold the response open as an event stream; replays messages after lastId first. */
export function openStream({ req, res, token, role, headers = {}, lastId = 0 }) {
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const client = { res, role };
  if (!channels.has(token)) channels.set(token, new Set());
  channels.get(token).add(client);
  for (const m of db.listMessages(token, lastId)) write(client, 'message', publicMessage(m), m.id);
  broadcast(token, 'presence', presence(token));
  req.on('close', () => {
    const set = channels.get(token);
    if (!set) return;
    set.delete(client);
    if (!set.size) channels.delete(token);
    broadcast(token, 'presence', presence(token));
  });
}

export function postMessage(token, msg) {
  const saved = publicMessage(db.insertMessage({ token, ...msg }));
  broadcast(token, 'message', saved, saved.id);
  return saved;
}

export const typing = (token, role) => broadcast(token, 'typing', { role });

/** End every stream on a link, telling both sides why. */
export function closeChannel(token, reason) {
  const set = channels.get(token);
  if (!set) return;
  channels.delete(token);
  for (const c of set) {
    write(c, 'closed', { reason });
    try { c.res.end(); } catch { /* already closed */ }
  }
}

// Heartbeat: keeps idle streams alive through phones and proxies, and ends chats whose link has expired.
setInterval(() => {
  for (const [token, set] of channels) {
    const h = db.getHandoff(token);
    if (!h || h.revoked) { closeChannel(token, 'revoked'); continue; }
    if (Date.parse(h.expires_at) < Date.now()) { closeChannel(token, 'expired'); continue; }
    for (const c of set) { try { c.res.write(': ping\n\n'); } catch { /* close handler cleans up */ } }
  }
}, HEARTBEAT_MS).unref();
