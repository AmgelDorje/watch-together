// Watch Together - background. Holds the live connection to the room server
// and relays room state to every page that has a video.
const DEFAULT_SERVER = 'https://watch-together-yzqa.onrender.com';

let cfg = { server: DEFAULT_SERVER, room: '', nudge: 0 };
let roomState = null;
let people = 0;
let connected = false;
let clockOffset = 0;      // server clock minus this computer's clock, ms
let streamCtrl = null;
const ports = new Set();  // one per frame that has a video

const ready = chrome.storage.local.get(['server', 'room', 'nudge']).then((s) => {
  // an old local-only address from early testing falls back to the live server
  const server = s.server && !/localhost|127\.0\.0\.1/.test(s.server) ? s.server : DEFAULT_SERVER;
  cfg = { server, room: s.room || '', nudge: Number(s.nudge) || 0 };
  if (cfg.room) connect();
});

function badge() {
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#3a9d5d' : '#9a9ca3' });
  chrome.action.setBadgeText({ text: cfg.room ? (connected ? String(people || '') : '!') : '' });
}

function toPorts(msg) { ports.forEach((p) => { try { p.postMessage(msg); } catch (e) {} }); }
// ready = we have heard the room's real state, so pages may act on it.
const stateMsg = () => ({ type: 'state', state: roomState, clockOffset, nudge: cfg.nudge, room: cfg.room, ready: connected && !!roomState });
function pushState() { toPorts(stateMsg()); }

async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await fetch(cfg.server + '/time', { cache: 'no-store' });
    const { t } = await r.json();
    const t1 = Date.now();
    if (t1 - t0 < best) { best = t1 - t0; clockOffset = t - (t0 + t1) / 2; }
  }
}

async function connect() {
  if (streamCtrl) streamCtrl.abort();
  const ctrl = new AbortController();
  streamCtrl = ctrl;
  if (!cfg.room) { connected = false; roomState = null; badge(); pushState(); return; }
  try {
    await syncClock();
    const res = await fetch(`${cfg.server}/events?r=${encodeURIComponent(cfg.room)}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('bad status ' + res.status);
    connected = true; badge();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const m = JSON.parse(line.slice(6));
        if (m.type === 'state') { roomState = m.state; pushState(); }
        if (m.type === 'people') { people = m.count; badge(); }
      }
    }
  } catch (e) { /* dropped or aborted */ }
  if (streamCtrl === ctrl) {
    connected = false; badge();
    setTimeout(() => { if (streamCtrl === ctrl) connect(); }, 2000);
  }
}

async function post(body) {
  if (!cfg.room) return;
  try {
    await fetch(`${cfg.server}/action?r=${encodeURIComponent(cfg.room)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (e) { /* the stream reconnect will resync */ }
}

// Pages with a video connect here. Their heartbeat also keeps this worker alive.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wt-video') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (m) => {
    await ready;
    if (m.type === 'hello' || m.type === 'ping') {
      if (cfg.room && !connected && !streamCtrl) connect();
      if (m.type === 'hello') port.postMessage(stateMsg());
    } else if (m.type === 'drift') {
      port.drift = { diff: m.diff, playing: m.playing, at: Date.now() };
    } else if (m.type === 'state') {
      roomState = { ...(roomState || {}), playing: m.playing, pos: m.pos, at: m.at, by: m.by };
      pushState(); // other tabs on this computer follow right away
      post({ type: 'state', playing: m.playing, pos: m.pos, at: m.at, by: m.by });
    }
  });
});

// The popup.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  ready.then(async () => {
    if (m.cmd === 'join') {
      cfg.room = m.room; cfg.server = (m.server || DEFAULT_SERVER).replace(/\/+$/, '');
      await chrome.storage.local.set({ room: cfg.room, server: cfg.server });
      people = 0; roomState = null; connect();
    } else if (m.cmd === 'leave') {
      cfg.room = ''; await chrome.storage.local.set({ room: '' });
      connect();
    } else if (m.cmd === 'nudge') {
      cfg.nudge = Math.round(m.value * 10) / 10;
      await chrome.storage.local.set({ nudge: cfg.nudge });
      pushState();
    }
    const tabId = m.tabId;
    const here = [...ports].filter((p) => p.sender && p.sender.tab && p.sender.tab.id === tabId);
    const fresh = here.map((p) => p.drift).filter((d) => d && Date.now() - d.at < 3000);
    reply({ ...cfg, connected, people, videoHere: here.length > 0, drift: fresh[0] || null });
  });
  return true;
});

// Free hosting sleeps after ~15 min without requests - check in while in a room.
setInterval(() => {
  // re-measuring the clock is also the keep-awake request
  if (cfg.room) syncClock().then(pushState).catch(() => {});
}, 4 * 60 * 1000);

badge();
