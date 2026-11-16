const $ = (s) => document.querySelector(s);
let tabId = null;
let cfg = null;

function send(msg) {
  return chrome.runtime.sendMessage({ ...msg, tabId }).then(render);
}

function render(s) {
  cfg = s;
  if (!$('#server').value) $('#server').value = s.server;
  $('#out').hidden = !!s.room;
  $('#in').hidden = !s.room;
  if (!s.room) return;
  $('#roomcode').textContent = s.room.toUpperCase();
  $('#dot').className = 'dot' + (s.connected ? ' on' : '');
  $('#status').textContent = !s.connected ? 'Connecting to the room...'
    : s.people <= 1 ? 'Waiting for your partner' : s.people + ' devices in the room';
  $('#vdot').className = 'dot' + (s.videoHere ? ' on' : '');
  $('#vstatus').textContent = s.videoHere ? 'Video found on this page' : 'No video on this page yet';
  $('#nudge').textContent = (s.nudge > 0 ? '+' : '') + s.nudge + ' s';
}

const server = () => $('#server').value.trim() || undefined;
const clean = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);

$('#create').onclick = () => send({ cmd: 'join', room: Math.random().toString(36).slice(2, 8), server: server() });
$('#join').onclick = () => {
  const room = clean($('#code').value);
  if (room.length < 4) { $('#code').focus(); return; }
  send({ cmd: 'join', room, server: server() });
};
$('#code').onkeydown = (e) => { if (e.key === 'Enter') $('#join').click(); };
$('#leave').onclick = () => send({ cmd: 'leave' });
$('#plus').onclick = () => send({ cmd: 'nudge', value: cfg.nudge + 0.5 });
$('#minus').onclick = () => send({ cmd: 'nudge', value: cfg.nudge - 0.5 });
$('#copy').onclick = () => {
  navigator.clipboard.writeText(cfg.room.toUpperCase());
  $('#copy').textContent = 'Copied';
  setTimeout(() => { $('#copy').textContent = 'Copy'; }, 1200);
};

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab && tab.id;
  send({ cmd: 'status' });
  setInterval(() => send({ cmd: 'status' }), 1500);
});
