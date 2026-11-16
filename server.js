// Watch Together - tiny sync server. No dependencies: `node server.js`
// Holds one shared playback state per room and pushes every change to all
// devices in that room (Server-Sent Events, works in old TV browsers too).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8787;
const rooms = new Map(); // roomId -> { state, clients:Set<res> }
const ROOM_RE = /^[a-z0-9]{4,12}$/;

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      state: { src: null, playing: false, pos: 0, at: 0, by: null }, // at:0 = nobody has played yet
      clients: new Set(),
    });
  }
  return rooms.get(id);
}

const send = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const broadcast = (room, obj) => room.clients.forEach((c) => send(c, obj));
const people = (room) => broadcast(room, { type: 'people', count: room.clients.size });

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  const roomId = u.searchParams.get('r') || '';

  // Clock sync: every device measures its offset to this clock.
  if (u.pathname === '/time') return json(res, 200, { t: Date.now() });

  // Live stream of room state.
  if (u.pathname === '/events') {
    if (!ROOM_RE.test(roomId)) return json(res, 400, { error: 'bad room' });
    const room = getRoom(roomId);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    room.clients.add(res);
    send(res, { type: 'state', state: room.state });
    people(room);
    const keepAlive = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      room.clients.delete(res);
      people(room);
    });
    return;
  }

  // A device reports play / pause / jump, or a new movie.
  if (u.pathname === '/action' && req.method === 'POST') {
    if (!ROOM_RE.test(roomId)) return json(res, 400, { error: 'bad room' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10000) return json(res, 413, { error: 'too big' });
    }
    let msg;
    try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
    const room = getRoom(roomId);
    const serverNow = Date.now();
    if (msg.type === 'source') {
      room.state = { src: msg.src || null, playing: false, pos: 0, at: serverNow, by: msg.by };
    } else if (msg.type === 'state') {
      const at = Number(msg.at);
      room.state = {
        ...room.state,
        playing: !!msg.playing,
        pos: Math.max(0, Number(msg.pos) || 0),
        // device's timestamp (already corrected to server clock), never in the future
        at: at && at <= serverNow + 50 && at > serverNow - 5000 ? at : serverNow,
        by: msg.by,
      };
    } else {
      return json(res, 400, { error: 'unknown type' });
    }
    broadcast(room, { type: 'state', state: room.state });
    return json(res, 200, { ok: true });
  }

  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }

  if (u.pathname === '/privacy') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'privacy.html')).pipe(res);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Watch Together running:`);
  console.log(`  this Mac:      http://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  same Wi-Fi:    http://${ip}:${PORT}`));
});
