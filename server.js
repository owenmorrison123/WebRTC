// Campus Portal — signaling + static server.
// Media flows peer-to-peer (or via TURN); this server only relays the handshake.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const ROOM_KEY = (process.env.ROOM_KEY || '').trim();          // shared secret; empty = no check
const GRACE_MS = Number(process.env.GRACE_MS || 15000); // keep a dropped peer's slot this long
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- ICE (STUN/TURN) config ----------
function iceServers() {
  if (process.env.ICE_SERVERS) {
    try { return JSON.parse(process.env.ICE_SERVERS); }
    catch (e) { console.error('ICE_SERVERS is not valid JSON:', e.message); }
  }
  const servers = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') }];
  const turnUrls = process.env.TURN_URLS ? process.env.TURN_URLS.split(',') : null;
  if (turnUrls && process.env.TURN_SECRET) {
    // coturn "use-auth-secret" / REST API: short-lived credentials
    const ttl = Number(process.env.TURN_TTL || 86400);
    const username = `${Math.floor(Date.now() / 1000) + ttl}:portal`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  } else if (turnUrls) {
    servers.push({ urls: turnUrls, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  }
  return servers;
}

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const keyOk = (k) => !ROOM_KEY || (k || '').trim() === ROOM_KEY;

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config') {
    if (!keyOk(url.searchParams.get('key'))) { res.writeHead(403); return res.end('forbidden'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: iceServers() }));
  }
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  let file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = (process.env.SSL_CERT && process.env.SSL_KEY)
  ? https.createServer({ cert: fs.readFileSync(process.env.SSL_CERT), key: fs.readFileSync(process.env.SSL_KEY) }, handler)
  : http.createServer(handler);

// ---------- signaling ----------
// rooms: name -> Map<clientId, { ws, polite, label, graceTimer }>
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const log = (...a) => console.log(new Date().toISOString(), ...a);

function others(room, id) { return [...room.entries()].filter(([k]) => k !== id); }

function removePeer(roomName, id) {
  const room = rooms.get(roomName);
  if (!room || !room.has(id)) return;
  clearTimeout(room.get(id).graceTimer);
  room.delete(id);
  for (const [, p] of room) send(p.ws, { type: 'peer-left' });
  if (room.size === 0) rooms.delete(roomName);
  log(`[${roomName}] ${id} left (${room.size} remain)`);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomName = ((url.searchParams.get('room') || '').trim() || 'portal').slice(0, 64);
  const id = (url.searchParams.get('id') || '').slice(0, 64);
  const label = (url.searchParams.get('label') || '').slice(0, 64);

  if (!keyOk(url.searchParams.get('key'))) { send(ws, { type: 'error', reason: 'bad-key' }); return ws.close(4001, 'bad key'); }
  if (!id) return ws.close(4000, 'missing id');

  if (!rooms.has(roomName)) rooms.set(roomName, new Map());
  const room = rooms.get(roomName);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const existing = room.get(id);
  if (existing) {
    // Same browser reconnecting its signaling socket — swap silently, keep the media session.
    clearTimeout(existing.graceTimer);
    existing.graceTimer = null;
    try { existing.ws.terminate(); } catch {}
    existing.ws = ws;
    send(ws, { type: 'joined', polite: existing.polite, resumed: true, peer: others(room, id).length ? { id: others(room, id)[0][0], label: others(room, id)[0][1].label } : null });
    log(`[${roomName}] ${id} resumed`);
  } else {
    // Room is 1-to-1. If full, evict a peer whose socket is already dead (e.g. a reloaded page).
    if (room.size >= 2) {
      const stale = others(room, id).find(([, p]) => p.graceTimer);
      if (stale) removePeer(roomName, stale[0]);
    }
    if (room.size >= 2) { send(ws, { type: 'error', reason: 'room-full' }); return ws.close(4002, 'room full'); }
    const other = others(room, id)[0];
    const polite = other ? !other[1].polite : false;
    room.set(id, { ws, polite, label, graceTimer: null });
    send(ws, { type: 'joined', polite, peer: other ? { id: other[0], label: other[1].label } : null });
    if (other) send(other[1].ws, { type: 'peer-joined', peer: { id, label } });
    log(`[${roomName}] ${id} joined (${room.size}/2) polite=${polite}`);
  }

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'signal') for (const [, p] of others(room, id)) send(p.ws, { type: 'signal', data: msg.data });
  });

  ws.on('close', () => {
    const me = room.get(id);
    if (!me || me.ws !== ws) return; // already replaced by a resumed socket
    me.graceTimer = setTimeout(() => removePeer(roomName, id), GRACE_MS);
  });
});

// Heartbeat: detect half-open sockets quickly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 10000);

server.listen(PORT, () => log(`Campus Portal listening on ${process.env.SSL_CERT ? 'https' : 'http'}://0.0.0.0:${PORT}${ROOM_KEY ? ' (room key required)' : ''}`));
