// Watch Together - runs in every page and frame. Finds the main video player
// and keeps it in step with the room.
(() => {
  if (window.__watchTogether) return;
  window.__watchTogether = true;

  const me = Math.random().toString(36).slice(2, 10);
  let video = null;
  let port = null;
  let state = null;
  let clockOffset = 0;
  let nudge = 0;          // seconds this side is shifted vs the room (different intros etc.)
  let room = '';
  let applyingUntil = 0;  // ignore our own player events while we follow the room
  let stuck = 0;
  let toast = null;

  const serverNow = () => Date.now() + clockOffset;
  const roomPos = () => (!state ? 0 : state.playing ? state.pos + (serverNow() - state.at) / 1000 : state.pos);
  const target = () => Math.max(0, roomPos() + nudge);

  // The biggest real video on the page (skips thumbnails and short ads).
  function findVideo() {
    let best = null, bestArea = 0;
    document.querySelectorAll('video').forEach((v) => {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      const tooShort = v.duration && isFinite(v.duration) && v.duration < 60;
      if (area > 40000 && area > bestArea && !tooShort) { best = v; bestArea = area; }
    });
    return best;
  }

  function connectPort() {
    port = chrome.runtime.connect({ name: 'wt-video' });
    port.onMessage.addListener((m) => {
      if (m.type !== 'state') return;
      clockOffset = m.clockOffset; nudge = m.nudge || 0;
      if (!m.room) { room = ''; state = null; hideToast(); return; }
      if (!m.ready) return; // still connecting - don't touch the player yet
      room = m.room;
      state = m.state && m.state.at ? m.state : null;
      if (!state) { report(true); return; } // nobody played yet: our position becomes the room's
      if (state.by !== me) apply();
    });
    port.onDisconnect.addListener(() => { port = null; setTimeout(() => { if (video) connectPort(); }, 1000); });
    port.postMessage({ type: 'hello' });
  }

  function bind(v) {
    if (video === v) return;
    video = v;
    ['play', 'pause', 'seeked'].forEach((ev) => v.addEventListener(ev, () => report(false)));
    v.addEventListener('loadedmetadata', () => apply());
    if (!port) connectPort(); else port.postMessage({ type: 'hello' });
  }

  // A person changed our player -> tell the room.
  function report(force) {
    if (!video || !port || !room || Date.now() < applyingUntil) return;
    const playing = !video.paused;
    const pos = Math.max(0, video.currentTime - nudge);
    if (!force && state && playing === state.playing && Math.abs(video.currentTime - target()) < 1) return;
    const at = serverNow();
    state = { ...(state || {}), playing, pos, at, by: me };
    port.postMessage({ type: 'state', playing, pos, at, by: me });
  }

  function seekTo(t) {
    applyingUntil = Date.now() + 1200;
    try { video.currentTime = t; } catch (e) {}
  }

  // Make our player match the room.
  function apply() {
    if (!video || !state || !room) return;
    applyingUntil = Date.now() + 1200;
    if (state.playing && video.paused) {
      if (Math.abs(video.currentTime - target()) > 0.05) seekTo(target());
      const p = video.play();
      if (p && p.catch) p.catch(() => showToast());
    } else if (!state.playing) {
      if (!video.paused) video.pause();
      setRate(1);
      if (Math.abs(video.currentTime - target()) > 0.05) seekTo(target()); // same frame when paused
    } else if (Math.abs(video.currentTime - target()) > 1) {
      seekTo(target()); // big gap: jump; small gaps are smoothed below
    }
  }

  // Small gaps while playing: play a few % faster/slower until we line up.
  let rateSet = false;
  function setRate(r) {
    if (!video) return;
    if (r === 1 && !rateSet) return;
    rateSet = r !== 1;
    try { video.playbackRate = r; } catch (e) {}
  }
  setInterval(() => {
    if (!video || !state || !room || !state.playing || video.paused || video.seeking) { setRate(1); return; }
    if (Date.now() < applyingUntil) return;
    const diff = video.currentTime - target(); // + = we are ahead
    if (Math.abs(diff) > 1) { setRate(1); seekTo(target()); }
    else if (Math.abs(diff) > 0.04) setRate(1 - Math.max(-0.05, Math.min(0.05, diff * 0.25)));
    else if (Math.abs(diff) < 0.02) setRate(1);
  }, 250);

  function showToast() {
    if (toast) return;
    toast = document.createElement('button');
    toast.textContent = 'Watch Together: click to join playback';
    toast.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);' +
      'padding:12px 18px;border:0;border-radius:12px;background:#ffcf5a;color:#16130a;' +
      'font:600 15px -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    toast.onclick = (e) => { e.stopPropagation(); hideToast(); apply(); };
    (document.fullscreenElement || document.body).appendChild(toast);
  }
  function hideToast() { if (toast) { toast.remove(); toast = null; } }

  // Every second: look for the player, fix drift, keep the connection alive.
  let tick = 0;
  setInterval(() => {
    const v = findVideo();
    if (v) bind(v);
    if (++tick % 20 === 0 && port) port.postMessage({ type: 'ping' });
    if (!video || !state || !room) return;
    const diff = video.currentTime - target();
    if (port) port.postMessage({ type: 'drift', diff, playing: !video.paused });
    if (Date.now() < applyingUntil) return;
    if (state.playing && !video.paused) {
      stuck = 0; hideToast(); // drift is handled by the speed controller
    } else if (state.playing && video.paused) {
      if (++stuck >= 2) showToast(); // browser blocked play without a click
    } else {
      stuck = 0;
      if (!state.playing && video.paused && Math.abs(diff) > 1) report(false); // jumped while paused
    }
  }, 1000);
})();
