'use strict';
// Campus Portal client — always-on 1-to-1 WebRTC with low-latency tuning.

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

const PRESETS = {
  540:  { w: 960,  h: 540,  kbps: 1200 },
  720:  { w: 1280, h: 720,  kbps: 2500 },
  1080: { w: 1920, h: 1080, kbps: 4500 },
};

if (!Q.get('room')) setup(); else portal();

/* =====================================================================
   SETUP SCREEN — builds the kiosk URL for each site
   ===================================================================== */
async function setup() {
  $('setup').style.display = 'block';
  const f = (id) => $(id);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    f('s-preview').srcObject = stream;
  } catch (e) { f('s-url').textContent = 'Camera/mic permission is needed to list devices: ' + e.message; }

  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind) => devs.filter((d) => d.kind === kind).forEach((d, i) => {
    const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `${kind} ${i + 1}`; f(sel).appendChild(o);
  });
  fill('s-cam', 'videoinput'); fill('s-mic', 'audioinput'); fill('s-spk', 'audiooutput');

  const build = () => {
    const p = new URLSearchParams();
    p.set('room', f('s-room').value.trim() || 'portal');
    if (f('s-key').value.trim()) p.set('key', f('s-key').value.trim());
    if (f('s-label').value) p.set('label', f('s-label').value);
    p.set('res', f('s-res').value);
    if (f('s-cam').value) p.set('cam', f('s-cam').value);
    if (f('s-mic').value) p.set('mic', f('s-mic').value);
    if (f('s-spk').value) p.set('spk', f('s-spk').value);
    if (f('s-codec').value) p.set('codec', f('s-codec').value);
    if (!f('s-self').checked) p.set('self', '0');
    if (f('s-contain').checked) p.set('fit', 'contain');
    if (f('s-stats').checked) p.set('stats', '1');
    const url = `${location.origin}${location.pathname}?${p}`;
    f('s-url').textContent = url;
    return url;
  };
  document.querySelectorAll('#setup input, #setup select').forEach((el) => el.addEventListener('input', build));
  f('s-cam').addEventListener('change', async () => {
    stream?.getTracks().forEach((t) => t.stop());
    try { stream = await navigator.mediaDevices.getUserMedia({ video: f('s-cam').value ? { deviceId: { exact: f('s-cam').value } } : true }); f('s-preview').srcObject = stream; } catch {}
  });
  // Check the room key against the server as it's typed, so a typo shows up here, not on the kiosk.
  let keyTimer;
  const checkKey = () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(async () => {
      const st = f('s-key-status');
      try {
        const r = await fetch(`/config?key=${encodeURIComponent(f('s-key').value.trim())}`, { cache: 'no-store' });
        const ok = r.status !== 403;
        st.className = 'keystat ' + (ok ? 'ok' : 'bad');
        st.textContent = ok ? '✓ Key accepted' : (f('s-key').value.trim() ? '✗ Key doesn’t match the server. Check for typos (1 vs l, 0 vs O).' : 'This server needs a room key.');
        f('s-go').disabled = !ok;
      } catch { st.textContent = ''; }
    }, 300);
  };
  f('s-key').addEventListener('input', checkKey);
  checkKey();
  build();
  f('s-go').onclick = () => { stream?.getTracks().forEach((t) => t.stop()); location.href = build(); };
  f('s-copy').onclick = async () => { await navigator.clipboard.writeText(build()); f('s-copy').textContent = 'Copied'; setTimeout(() => (f('s-copy').textContent = 'Copy link'), 1500); };
}

/* =====================================================================
   PORTAL
   ===================================================================== */
async function portal() {
  $('portal').style.display = 'block';

  const cfg = {
    room: Q.get('room').trim(),
    key: (Q.get('key') || '').trim(),
    label: Q.get('label') || '',
    preset: PRESETS[Q.get('res')] || PRESETS[720],
    fps: Number(Q.get('fps') || 30),
    kbps: Number(Q.get('bitrate') || 0),
    codec: (Q.get('codec') || '').toUpperCase(),
    jitterMs: Number(Q.get('jb') ?? 0),   // 0 = let WebRTC keep the jitter buffer as small as possible
    cam: Q.get('cam'), mic: Q.get('mic'), spk: Q.get('spk'),
  };
  cfg.kbps = cfg.kbps || cfg.preset.kbps;
  if (Q.get('self') === '0') document.body.classList.add('no-self');
  if (Q.get('fit') === 'contain') document.body.classList.add('fit-contain');
  if (Q.get('stats') === '1') document.body.classList.add('show-stats');

  const clientId = crypto.randomUUID();
  const remoteVideo = $('remote'), localVideo = $('local');
  let localStream = null, pc = null, ws = null, polite = false, peerLabel = '';
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let gen = 0; // peer-connection generation; bumps on full rebuild

  // ---------- UI helpers ----------
  const status = (title, sub = '', show = true) => {
    $('ov-title').textContent = title; $('ov-sub').textContent = sub;
    $('overlay').classList.toggle('hidden', !show);
  };
  const setDot = (cls, text) => { $('dot').className = cls; $('label-text').textContent = text; };
  const wrongKey = () => {
    status('Wrong room key', cfg.key ? 'The key in this link doesn’t match the server. Enter the correct key:' : 'This portal needs a room key. Enter it below:');
    document.querySelector('#overlay .ring').style.display = 'none';
    const form = $('ov-key'); form.style.display = 'flex';
    $('ov-key-input').value = cfg.key; $('ov-key-input').focus();
    form.onsubmit = (e) => {
      e.preventDefault();
      const u = new URL(location.href); u.searchParams.set('key', $('ov-key-input').value.trim());
      location.replace(u);
    };
  };

  // ---------- ICE config ----------
  try {
    const r = await fetch(`/config?key=${encodeURIComponent(cfg.key)}`, { cache: 'no-store' });
    if (r.status === 403) return wrongKey();
    iceServers = (await r.json()).iceServers;
  } catch (e) { console.warn('config fetch failed, using default STUN', e); }

  // ---------- Local media ----------
  async function getMedia() {
    const video = {
      width: { ideal: cfg.preset.w }, height: { ideal: cfg.preset.h },
      frameRate: { ideal: cfg.fps, max: cfg.fps },
      ...(cfg.cam ? { deviceId: { ideal: cfg.cam } } : {}),
    };
    const audio = {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      channelCount: 1, sampleRate: 48000,
      ...(cfg.mic ? { deviceId: { ideal: cfg.mic } } : {}),
    };
    for (;;) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video, audio });
        const vt = s.getVideoTracks()[0]; if (vt) vt.contentHint = 'motion';
        const at = s.getAudioTracks()[0]; if (at) at.contentHint = 'speech';
        s.getTracks().forEach((t) => t.addEventListener('ended', onTrackEnded));
        return s;
      } catch (e) {
        status('Camera or microphone unavailable', `${e.name}: ${e.message} — retrying…`);
        await sleep(4000);
      }
    }
  }
  let reacquiring = false;
  async function onTrackEnded() {
    // Device unplugged / driver reset: reacquire and hot-swap without renegotiating.
    if (reacquiring) return;
    reacquiring = true;
    console.warn('local track ended, reacquiring');
    await sleep(1000);
    const fresh = await getMedia();
    localStream.getTracks().forEach((t) => t.stop());
    localStream = fresh; localVideo.srcObject = fresh;
    applyMuteState();
    if (pc) for (const s of pc.getSenders()) {
      const t = s.track && fresh.getTracks().find((x) => x.kind === s.track.kind);
      if (t) await s.replaceTrack(t).catch(() => {});
    }
    if (pc?.connectionState === 'connected') status('', '', false);
    reacquiring = false;
  }

  status('Starting camera…');
  localStream = await getMedia();
  localVideo.srcObject = localStream;
  if (cfg.spk && remoteVideo.setSinkId) remoteVideo.setSinkId(cfg.spk).catch((e) => console.warn('setSinkId', e));

  // ---------- Signaling (WebSocket with auto-reconnect) ----------
  let wsBackoff = 500;
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const p = new URLSearchParams({ room: cfg.room, id: clientId, label: cfg.label, key: cfg.key });
    ws = new WebSocket(`${proto}://${location.host}/ws?${p}`);
    ws.onopen = () => { wsBackoff = 500; };
    ws.onmessage = (e) => onWsMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (e.code === 4001) return wrongKey();
      if (e.code === 4002) status('Room is full', 'Two portals are already connected in this room. Retrying…');
      if (!pc || pc.connectionState !== 'connected') setDot('bad', 'Signaling offline — reconnecting…');
      setTimeout(connectWs, wsBackoff);
      wsBackoff = Math.min(wsBackoff * 2, 10000);
    };
  }
  const signal = (data) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'signal', data: { ...data, gen } })); };

  // peerId = the remote browser our current RTCPeerConnection talks to. Media is P2P, so if the
  // signaling server restarts we keep a healthy call running instead of tearing it down.
  let peerId = null, peerPresent = false;
  const healthy = () => pc && pc.connectionState === 'connected';
  function onWsMessage(msg) {
    if (msg.type === 'joined') {
      polite = msg.polite;
      if (msg.peer) {
        peerPresent = true; peerLabel = msg.peer.label;
        if (!(pc && msg.peer.id === peerId)) { peerId = msg.peer.id; closePc(); gen = 0; createPc(); }
      } else {
        peerPresent = false;
        if (!healthy()) { closePc(); waiting(); } // else: other side will re-register shortly
      }
    } else if (msg.type === 'peer-joined') {
      peerPresent = true; peerLabel = msg.peer.label;
      if (healthy() && msg.peer.id === peerId) return;
      peerId = msg.peer.id; closePc(); gen = 0; createPc();
    } else if (msg.type === 'peer-left') {
      peerPresent = false; peerId = null; closePc(); waiting();
    } else if (msg.type === 'signal') {
      enqueue(() => onSignal(msg.data));
    }
  }
  const waiting = () => { status('Waiting for the other campus…', cfg.label ? `This is ${cfg.label} · room “${cfg.room}”` : `Room “${cfg.room}”`); setDot('', 'Waiting for other site'); };

  // Process signaling messages strictly in order.
  let chain = Promise.resolve();
  const enqueue = (fn) => { chain = chain.then(fn).catch((e) => console.error('signal error', e)); };

  // ---------- Peer connection (perfect negotiation) ----------
  let makingOffer = false, ignoreOffer = false, settingRemoteAnswer = false;
  let watchdog = null, discTimer = null;

  function createPc() {
    status('Connecting…', peerLabel ? `to ${peerLabel}` : '');
    setDot('', 'Connecting…');
    makingOffer = ignoreOffer = settingRemoteAnswer = false;
    pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 4 });
    const myPc = pc;

    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream);
      const tr = pc.getTransceivers().find((t) => t.sender === sender);
      if (track.kind === 'video') preferCodec(tr);
    }

    pc.onnegotiationneeded = async () => {
      try { makingOffer = true; await myPc.setLocalDescription(); signal({ description: myPc.localDescription }); }
      catch (e) { console.error(e); } finally { makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) signal({ candidate }); };

    pc.ontrack = ({ track, streams, receiver }) => {
      tuneReceiver(receiver);
      if (remoteVideo.srcObject !== streams[0]) {
        remoteVideo.srcObject = streams[0];
        remoteVideo.play().catch(() => askForGesture());
      }
      track.onunmute = () => remoteVideo.play().catch(() => askForGesture());
    };

    pc.onconnectionstatechange = () => {
      if (myPc !== pc) return;
      const s = pc.connectionState;
      console.log('connectionState', s);
      clearTimeout(discTimer);
      if (s === 'connected') {
        clearTimeout(watchdog); watchdog = null;
        status('', '', false);
        setDot('ok', peerLabel || 'Connected');
        tuneSenders();
      } else if (s === 'disconnected') {
        setDot('bad', 'Connection unstable…');
        discTimer = setTimeout(() => { if (pc?.connectionState === 'disconnected') pc.restartIce(); }, 2500);
        armWatchdog();
      } else if (s === 'failed') {
        setDot('bad', 'Reconnecting…');
        status('Reconnecting…', 'The network path dropped. Restoring the link.');
        pc.restartIce();
        armWatchdog();
      }
    };
    armWatchdog();
  }

  // If ICE restarts don't recover within 20s, the impolite side rebuilds the whole connection.
  function armWatchdog() {
    if (watchdog) return;
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!pc || pc.connectionState === 'connected') return;
      if (!peerPresent) { closePc(); peerId = null; return waiting(); }
      if (!polite) { gen++; signal({ reset: true }); rebuild(); }
      else armWatchdog();
    }, 20000);
  }
  function rebuild() { closePc(true); createPc(); }

  function closePc(keepUi) {
    clearTimeout(watchdog); watchdog = null; clearTimeout(discTimer);
    if (pc) { pc.onnegotiationneeded = pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); }
    pc = null;
    if (!keepUi) remoteVideo.srcObject = null;
  }

  async function onSignal(data) {
    if (data.reset) { if (data.gen > gen) { gen = data.gen; rebuild(); } return; }
    if (data.gen !== gen || !pc) return; // stale message from an older connection
    const { description, candidate } = data;
    if (description) {
      const readyForOffer = !makingOffer && (pc.signalingState === 'stable' || settingRemoteAnswer);
      const collision = description.type === 'offer' && !readyForOffer;
      ignoreOffer = !polite && collision;
      if (ignoreOffer) return;
      settingRemoteAnswer = description.type === 'answer';
      await pc.setRemoteDescription(description);
      settingRemoteAnswer = false;
      if (description.type === 'offer') { await pc.setLocalDescription(); signal({ description: pc.localDescription }); }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!ignoreOffer) console.warn('addIceCandidate', e); }
    }
  }

  // ---------- Low-latency tuning ----------
  function preferCodec(transceiver) {
    if (!cfg.codec || !transceiver?.setCodecPreferences || !RTCRtpReceiver.getCapabilities) return;
    const codecs = RTCRtpReceiver.getCapabilities('video').codecs;
    const want = codecs.filter((c) => c.mimeType.toUpperCase() === `VIDEO/${cfg.codec}`);
    if (!want.length) return console.warn(`codec ${cfg.codec} not supported here`);
    try { transceiver.setCodecPreferences([...want, ...codecs.filter((c) => !want.includes(c))]); } catch (e) { console.warn(e); }
  }

  function tuneReceiver(receiver) {
    // Ask the jitter buffer to hold as little as possible. This is the single biggest
    // receive-side latency knob; raise ?jb= (ms) if video looks choppy on a lossy link.
    try {
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = cfg.jitterMs;
      else if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = cfg.jitterMs / 1000;
    } catch (e) { console.warn('jitter buffer hint', e); }
  }

  async function tuneSenders() {
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue;
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      const enc = p.encodings[0];
      enc.priority = 'high';
      enc.networkPriority = 'high'; // DSCP marking where the network honors it
      if (sender.track.kind === 'video') {
        enc.maxBitrate = cfg.kbps * 1000;
        enc.maxFramerate = cfg.fps;
        // Under congestion drop resolution rather than frames — keeps motion smooth.
        p.degradationPreference = 'maintain-framerate';
      } else {
        enc.maxBitrate = 64000;
      }
      try { await sender.setParameters(p); } catch (e) { console.warn('setParameters', sender.track.kind, e.message); }
    }
  }

  // ---------- Autoplay with sound ----------
  function askForGesture() {
    const tap = $('tap'); tap.style.display = 'flex';
    const go = () => { tap.style.display = 'none'; remoteVideo.play().catch(() => {}); };
    tap.onclick = go; document.addEventListener('keydown', go, { once: true });
  }

  // ---------- Controls ----------
  let micOn = true, camOn = true;
  function applyMuteState() {
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
    $('b-mic').classList.toggle('off', !micOn); $('b-mic').textContent = micOn ? 'Mic' : 'Mic off';
    $('b-cam').classList.toggle('off', !camOn); $('b-cam').textContent = camOn ? 'Camera' : 'Camera off';
    localVideo.style.opacity = camOn ? 1 : 0.25;
  }
  const toggleMic = () => { micOn = !micOn; applyMuteState(); };
  const toggleCam = () => { camOn = !camOn; applyMuteState(); };
  const toggleStats = () => document.body.classList.toggle('show-stats');
  // Self-view on/off during a call. Also updates the address bar so a reload or bookmark keeps the choice.
  const applySelf = () => {
    const hidden = document.body.classList.contains('no-self');
    $('b-self').textContent = hidden ? 'Show self-view' : 'Hide self-view';
  };
  const toggleSelf = () => {
    const hidden = document.body.classList.toggle('no-self');
    applySelf();
    const u = new URL(location.href);
    if (hidden) u.searchParams.set('self', '0'); else u.searchParams.delete('self');
    history.replaceState(null, '', u);
  };
  applySelf();
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $('b-mic').onclick = toggleMic; $('b-cam').onclick = toggleCam; $('b-self').onclick = toggleSelf; $('b-stats').onclick = toggleStats; $('b-fs').onclick = toggleFs;
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'm') toggleMic(); else if (k === 'v') toggleCam(); else if (k === 'h') toggleSelf(); else if (k === 's') toggleStats(); else if (k === 'f') toggleFs();
  });
  remoteVideo.addEventListener('dblclick', toggleFs);

  // Hide cursor + toolbar when idle (kiosk friendly).
  let idle;
  const wake = () => {
    document.body.classList.remove('hide-cursor'); document.body.classList.add('show-ui');
    clearTimeout(idle); idle = setTimeout(() => { document.body.classList.add('hide-cursor'); document.body.classList.remove('show-ui'); }, 3000);
  };
  ['mousemove', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));
  wake();

  // Keep the screen awake.
  let lock;
  const keepAwake = async () => { try { if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen'); } catch {} };
  document.addEventListener('visibilitychange', keepAwake); keepAwake();

  // ---------- Live stats ----------
  let prev = {};
  setInterval(async () => {
    if (!pc || !document.body.classList.contains('show-stats')) return;
    const r = await pc.getStats();
    const by = {}; r.forEach((s) => (by[s.id] = s));
    let pair, inV, inA, outV, transport;
    r.forEach((s) => {
      if (s.type === 'transport') transport = s;
      if (s.type === 'inbound-rtp' && s.kind === 'video') inV = s;
      if (s.type === 'inbound-rtp' && s.kind === 'audio') inA = s;
      if (s.type === 'outbound-rtp' && s.kind === 'video') outV = s;
    });
    pair = transport?.selectedCandidatePairId ? by[transport.selectedCandidatePairId] : [...r.values()].find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
    const lc = pair && by[pair.localCandidateId], rc = pair && by[pair.remoteCandidateId];
    const path = !lc ? '–' : (lc.candidateType === 'relay' || rc?.candidateType === 'relay') ? 'TURN relay' : `direct P2P (${lc.candidateType}/${rc?.candidateType})`;
    const rtt = pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null;

    const d = (cur, key, field) => { const p = prev[key]; return p && cur ? { v: cur[field] - p[field], t: (cur.timestamp - p.timestamp) / 1000 } : null; };
    const kbps = (cur, key) => { const x = d(cur, key, cur && 'bytesSent' in cur ? 'bytesSent' : 'bytesReceived'); return x ? Math.round((x.v * 8) / x.t / 1000) : 0; };
    const jbMs = (cur, key) => {
      const p = prev[key]; if (!p || !cur?.jitterBufferEmittedCount) return null;
      const n = cur.jitterBufferEmittedCount - p.jitterBufferEmittedCount;
      return n > 0 ? ((cur.jitterBufferDelay - p.jitterBufferDelay) / n) * 1000 : null;
    };
    const decMs = inV && prev.inV && inV.framesDecoded > prev.inV.framesDecoded ? ((inV.totalDecodeTime - prev.inV.totalDecodeTime) / (inV.framesDecoded - prev.inV.framesDecoded)) * 1000 : null;
    const encMs = outV && prev.outV && outV.framesEncoded > prev.outV.framesEncoded ? ((outV.totalEncodeTime - prev.outV.totalEncodeTime) / (outV.framesEncoded - prev.outV.framesEncoded)) * 1000 : null;
    const lossPct = (cur, key) => {
      const p = prev[key]; if (!p || !cur) return null;
      const lost = cur.packetsLost - p.packetsLost, got = cur.packetsReceived - p.packetsReceived;
      return lost + got > 0 ? (lost / (lost + got)) * 100 : 0;
    };
    const vJb = jbMs(inV, 'inV'), aJb = jbMs(inA, 'inA');
    // Rough one-way "glass-to-glass": capture+render (~1 frame each) + encode + network + jitter buffer + decode.
    const frame = 1000 / (inV?.framesPerSecond || cfg.fps);
    const est = rtt != null && vJb != null ? Math.round(frame * 2 + (encMs || 5) + rtt / 2 + vJb + (decMs || 5)) : null;

    const codec = inV?.codecId && by[inV.codecId]?.mimeType?.split('/')[1];
    const f = (v, u = '', dp = 0) => (v == null || isNaN(v) ? '–' : v.toFixed(dp) + u);
    $('stats').innerHTML =
`<b>Path</b>        ${path}
<b>RTT</b>         ${f(rtt, ' ms')}
<b>Est. delay</b>  ~${f(est, ' ms')} one-way

<b>Receiving</b>   ${inV ? `${inV.frameWidth || '?'}×${inV.frameHeight || '?'} @ ${f(inV.framesPerSecond)} fps ${codec || ''}` : '–'}
  bitrate     ${kbps(inV, 'inV')} kbps
  loss        ${f(lossPct(inV, 'inV'), ' %', 1)}
  jitter buf  ${f(vJb, ' ms')} video · ${f(aJb, ' ms')} audio
  decode      ${f(decMs, ' ms', 1)}
  freezes     ${inV?.freezeCount ?? '–'}

<b>Sending</b>     ${outV ? `${outV.frameWidth || '?'}×${outV.frameHeight || '?'} @ ${f(outV.framesPerSecond)} fps` : '–'}
  bitrate     ${kbps(outV, 'outV')} kbps (cap ${cfg.kbps})
  encode      ${f(encMs, ' ms', 1)}
  limited by  ${outV?.qualityLimitationReason || '–'}`;
    prev = { inV, inA, outV };
  }, 1000);

  // ---------- Go ----------
  waiting();
  connectWs();

  // If the tab was frozen/backgrounded for a long time, a full reload is the most reliable recovery.
  document.addEventListener('resume', () => location.reload());
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
