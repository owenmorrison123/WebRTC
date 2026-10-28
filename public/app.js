'use strict';
// Campus Portal client — always-on 1-to-1 WebRTC with low-latency tuning.

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// Bitrate caps are for 30 fps; 60 fps gets 1.6× (see autoKbps). The encoder still adapts downwards
// to what the network can carry; these are ceilings, not targets.
const APP_VERSION = '2026-10-21';
const PRESETS = {
  540:  { w: 960,  h: 540,  kbps: 1500 },
  720:  { w: 1280, h: 720,  kbps: 3000 },
  1080: { w: 1920, h: 1080, kbps: 6000 },
};
const autoKbps = (preset, fps) => Math.round((preset.kbps * (fps > 30 ? 1.6 : fps < 24 ? 0.6 : 1)) / 100) * 100;

/* =====================================================================
   THEMES — see THEMES.md. A theme is a folder in public/themes with a theme.json.
   ===================================================================== */
const THEME_DEFAULTS = {
  shape: 'rect', inset: 0, radius: 0, aspect: null, archRise: 0.4,
  border: { width: 0, color: 'transparent', gradient: null, spin: 0, innerWidth: 0, innerColor: null },
  glow: null, background: '#000', waiting: null,
  overlay: null, overlayFit: 'stretch', accent: null, selfView: {}, logo: null, badges: null, shade: null, waitScreen: null,
};
// Theme lengths are numbers in px, or "N%" strings meaning % of the shorter screen side.
const themeLen = (v, unit) => (typeof v === 'string' && v.trim().endsWith('%') ? parseFloat(v) * unit : Number(v) || 0);
// All badges a theme draws: the "badges" list, plus the older single "logo" field.
const themeBadges = (t) => [...(t.logo && (t.logo.file || t.logo.text) ? [t.logo] : []), ...(Array.isArray(t.badges) ? t.badges : [])].filter((b) => b && (b.file || b.text));
async function loadThemes() {
  try { return await (await fetch('/themes', { cache: 'no-store' })).json(); } catch { return []; }
}
// Relative url(...) values and file names in a theme are relative to the theme's own folder.
const themeUrl = (base, u) => (/^(data:|https?:|\/)/.test(u) ? u : base + u);
const themeCss = (base, v) => (typeof v === 'string' ? v.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => `url("${themeUrl(base, u.trim())}")`) : v);
const parseAspect = (a) => { if (!a) return null; if (typeof a === 'number') return a; const [w, h] = String(a).split(/[:/x]/).map(Number); return w > 0 && h > 0 ? w / h : null; };

/* ---------- Orientation ----------
   view.orient: '' (auto: follow the screen), 'landscape' or 'portrait'.
   view.rotate: 0, 90 or 270 — rotates the whole portal for a TV turned on its side when the computer
   can't rotate its own display output. The portal's "canvas" is the upright area everything is laid out in:
   with rotation it is the screen with width and height swapped; when the forced orientation doesn't match
   the screen (e.g. Portrait on a laptop), it is a centered 9:16 (or 16:9) preview box. */
const view = { orient: '', rotate: 0 };
let canvas = { W: window.innerWidth, H: window.innerHeight };
const isPortrait = () => canvas.H > canvas.W;
function layoutCanvas() {
  const el = $('portal'); if (!el) return;
  const vw = window.innerWidth, vh = window.innerHeight, rot = view.rotate === 90 || view.rotate === 270;
  let W = rot ? vh : vw, H = rot ? vw : vh;
  if (view.orient === 'portrait' && W > H) W = Math.round(H * 9 / 16);
  else if (view.orient === 'landscape' && H > W) H = Math.round(W * 9 / 16);
  canvas = { W, H };
  el.style.setProperty('--u', `${Math.min(W, H) / 100}px`); // 1% of the shorter side, for theme CSS
  Object.assign(el.style, { inset: 'auto', left: `${(vw - W) / 2}px`, top: `${(vh - H) / 2}px`, width: `${W}px`, height: `${H}px`, transform: view.rotate ? `rotate(${view.rotate}deg)` : '' });
}

let activeTheme = null, rawTheme = null;
// A theme can carry "portrait": {...} and "landscape": {...} blocks that override its fields in that orientation.
function themeFor(theme, orient) {
  const ov = theme?.[orient];
  if (!ov) return theme;
  const sub = (k) => (ov[k] === null ? null : ov[k] === undefined ? theme[k] : { ...(theme[k] || {}), ...ov[k] });
  return { ...theme, ...ov, border: sub('border'), glow: sub('glow'), logo: sub('logo'), selfView: sub('selfView'), waitScreen: sub('waitScreen') };
}
function applyTheme(raw) { rawTheme = raw || null; renderTheme(); }
function renderTheme() {
  layoutCanvas();
  const theme = themeFor(rawTheme, isPortrait() ? 'portrait' : 'landscape');
  const base = theme?.base || '';
  const t = { ...THEME_DEFAULTS, ...(theme || {}) };
  t.border = { ...THEME_DEFAULTS.border, ...(theme?.border || {}) };
  t.selfView = { ...(theme?.selfView || {}) };
  activeTheme = t;
  const root = document.documentElement.style, frame = $('frame'), portalEl = $('portal'), art = $('art'), local = $('local');

  portalEl.style.background = themeCss(base, t.background) || '#000';
  frame.style.background = themeCss(base, t.border.gradient || t.border.color) || 'transparent';
  frame.classList.toggle('spin', !!t.border.spin);
  if (t.border.innerWidth && t.border.innerColor) {
    frame.style.setProperty('--t-inner-w', `${t.border.innerWidth}px`); frame.style.setProperty('--t-inner-c', t.border.innerColor);
  } else { frame.style.removeProperty('--t-inner-w'); frame.style.removeProperty('--t-inner-c'); }
  frame.style.setProperty('--t-spin', `${t.border.spin || 8}s`);
  if (t.glow?.color) {
    frame.style.setProperty('--t-glow', `0 0 ${t.glow.size ?? 40}px ${t.glow.spread ?? 0}px ${t.glow.color}`);
    frame.classList.toggle('pulse', !!t.glow.pulse);
  } else { frame.style.removeProperty('--t-glow'); frame.classList.remove('pulse'); }

  // Themed waiting screen: a campus background inside the portal, the logo inside the spinner, a wordmark.
  const ws = t.waitScreen, ov = $('overlay'), ovLogo = $('ov-logo'), ovWord = $('ov-word');
  $('wait-bg').style.background = ws?.background ? themeCss(base, ws.background) : '';
  ov.classList.toggle('themed', !!ws);
  if (ws?.logo) ovLogo.src = themeUrl(base, ws.logo); else ovLogo.removeAttribute('src');
  if (ws?.wordmark) ovWord.src = themeUrl(base, ws.wordmark); else ovWord.removeAttribute('src');
  ovLogo.style.visibility = ws?.logo ? '' : 'hidden'; ovWord.style.display = ws?.wordmark ? '' : 'none';
  ovWord.style.filter = ws?.wordmarkFilter || '';
  for (const [k, v] of [['--ring', ws?.ringSize], ['--logo', ws?.logoSize], ['--word', ws?.wordmarkSize], ['--wait-fg', ws?.color], ['--wait-muted', ws?.subColor], ['--ring-track', ws?.ringTrack]]) {
    if (v != null) ov.style.setProperty(k, String(v)); else ov.style.removeProperty(k);
  }

  const framed = t.shape !== 'rect' || t.inset > 0 || themeLen(t.border.width, 1) > 0;
  if (ws) root.setProperty('--t-wait', 'transparent'); // the campus background is drawn inside the portal instead
  else if (t.waiting) root.setProperty('--t-wait', themeCss(base, t.waiting));
  else if (framed) root.setProperty('--t-wait', 'transparent'); // let the empty frame show while waiting
  else root.removeProperty('--t-wait');
  if (t.accent) root.setProperty('--accent', t.accent); else root.removeProperty('--accent');

  if (t.overlay) {
    art.src = themeUrl(base, t.overlay);
    art.style.objectFit = { stretch: 'fill', cover: 'cover', contain: 'contain' }[t.overlayFit] || 'fill';
    art.style.display = 'block';
  } else { art.removeAttribute('src'); art.style.display = 'none'; }

  // Shade: a CSS background painted over the video inside the portal (e.g. color fades at the edges).
  $('shade').style.background = t.shade ? themeCss(base, t.shade) : '';

  // Badges (logos, wordmarks): image files, or text badges until the real logo file is added.
  const holder = $('logo'); holder.innerHTML = '';
  for (const lg of themeBadges(t)) {
    const el = document.createElement('div'); el.className = 'badge';
    if (lg.file) { const img = document.createElement('img'); img.src = themeUrl(base, lg.file); img.alt = lg.text || ''; el.appendChild(img); }
    else { const sp = document.createElement('span'); sp.textContent = lg.text; sp.style.color = lg.color || '#fff'; if (lg.font) sp.style.fontFamily = lg.font; el.appendChild(sp); }
    Object.assign(el.style, { background: lg.plate || 'transparent', opacity: lg.opacity ?? 1, filter: lg.filter || '' });
    holder.appendChild(el);
  }

  const sv = t.selfView;
  local.style.borderColor = sv.border || '';
  local.style.borderRadius = sv.shape === 'circle' ? '50%' : sv.shape === 'rect' ? '0' : sv.radius != null ? `${sv.radius}px` : '';
  local.style.aspectRatio = sv.shape === 'circle' ? '1 / 1' : '';
  local.style.width = sv.shape === 'circle' ? 'min(16cqw, 220px)' : '';
  layoutFrame();
}
// Position and shape the frame for the current screen size (called on apply and on every resize).
function layoutFrame() {
  const t = activeTheme || THEME_DEFAULTS, frame = $('frame'), stage = $('stage');
  if (!frame) return;
  const W = canvas.W, H = canvas.H;
  const m = (Number(t.inset) || 0) / 100 * Math.min(W, H);
  const aspect = t.shape === 'circle' ? 1 : parseAspect(t.aspect);
  let w = W - 2 * m, h = H - 2 * m;
  if (aspect) { w = Math.min(w, h * aspect); h = w / aspect; }
  const bw = Math.max(0, themeLen(t.border.width, Math.min(W, H) / 100)), R = Math.max(0, Number(t.radius) || 0);
  let outer = '0', inner = '0';
  if (t.shape === 'rounded') { outer = `${R}px`; inner = `${Math.max(R - bw, 0)}px`; }
  else if (t.shape === 'circle' || t.shape === 'oval') { outer = inner = '50%'; }
  else if (t.shape === 'arch') {
    // Top is a half-ellipse: as wide as the frame, rising at most archRise × height. On a portrait
    // screen that is a true round doorway arch; on a landscape screen it flattens into an arched window.
    const rise = Math.min(w / 2, h * (Number(t.archRise) || 0.4));
    const a = w / 2, a2 = Math.max(a - bw, 0), v2 = Math.max(rise - bw, 0), r2 = Math.max(R - bw, 0);
    outer = `${a}px ${a}px ${R}px ${R}px / ${rise}px ${rise}px ${R}px ${R}px`;
    inner = `${a2}px ${a2}px ${r2}px ${r2}px / ${v2}px ${v2}px ${r2}px ${r2}px`;
  }
  Object.assign(frame.style, { inset: 'auto', left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, width: `${w}px`, height: `${h}px`, padding: `${bw}px`, borderRadius: outer });
  stage.style.borderRadius = inner;
  stageAspect = Math.max(w - 2 * bw, 1) / Math.max(h - 2 * bw, 1);
  onStageShape?.();

  // Badges: sized as a % of the shorter screen side. anchor "frame" (default) = inside the portal's edge,
  // "screen" = the screen edge, "border" = centered in the border band on that side.
  const unit = Math.min(W, H) / 100, els = $('logo')?.children || [];
  const fx = (W - w) / 2, fy = (H - h) / 2;
  themeBadges(t).forEach((lg, i) => {
    const el = els[i]; if (!el) return;
    const size = (Number(lg.size) || 6) * unit, pad = lg.plate ? size * 0.22 : 0, bh = size + 2 * pad;
    const gx = (lg.marginX ?? lg.margin ?? 2) * unit, gy = (lg.marginY ?? lg.margin ?? 2) * unit;
    const pos = lg.position || 'bottom-left';
    const [vy, hx] = pos === 'center' ? ['center', 'center'] : pos.includes('-') ? pos.split('-') : ['center', pos];
    let box = lg.anchor === 'screen' ? { l: 0, t: 0, r: W, b: H } : { l: fx + bw, t: fy + bw, r: fx + w - bw, b: fy + h - bw };
    let left = null, right = null, top = null, bottom = null, tx = '', ty = '';
    if (lg.anchor === 'border') {
      // Center the badge in the border band between the portal's outer and inner edge on that side.
      box = { l: fx, t: fy, r: fx + w, b: fy + h };
      const mid = (bw - bh) / 2;
      if (vy === 'bottom') bottom = H - box.b + mid; else if (vy === 'top') top = box.t + mid;
      if (vy === 'center' && hx === 'left') left = box.l + (bw - el.offsetWidth) / 2;
      if (vy === 'center' && hx === 'right') right = W - box.r + (bw - el.offsetWidth) / 2;
    }
    if (left === null && right === null) {
      if (hx === 'left') left = box.l + gx; else if (hx === 'right') right = W - box.r + gx; else { left = (box.l + box.r) / 2; tx = '-50%'; }
    }
    if (top === null && bottom === null) {
      if (vy === 'top') top = box.t + gy; else if (vy === 'bottom') bottom = H - box.b + gy; else { top = (box.t + box.b) / 2; ty = '-50%'; }
    }
    const px = (v) => (v === null ? 'auto' : `${v}px`);
    Object.assign(el.style, {
      height: `${bh}px`, padding: `${pad}px ${pad * 1.4}px`, borderRadius: `${Math.round(size * 0.25)}px`,
      left: px(left), right: px(right), top: px(top), bottom: px(bottom),
      maxWidth: `${Math.max(box.r - box.l - 2 * gx, 40)}px`, transform: tx || ty ? `translate(${tx || 0}, ${ty || 0})` : '',
    });
    const sp = el.querySelector('span'); if (sp) sp.style.fontSize = `${size * 0.62}px`;
  });
}
let stageAspect = 16 / 9, onStageShape = null; // the portal calls onStageShape to tell the other side
window.addEventListener('resize', () => renderTheme());

// Both campus clocks. Used on the setup page and in the portal.
const CLOCKS = [['Evansville', 'America/Chicago'], ['Harlaxton', 'Europe/London']];
function clockParts() {
  const now = new Date();
  return CLOCKS.map(([name, tz]) => [name, now.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' }),
    now.toLocaleDateString([], { timeZone: tz, weekday: 'short' })]);
}

if (!Q.get('room')) setup(); else portal();

/* =====================================================================
   SETUP SCREEN — builds the kiosk URL for each site
   ===================================================================== */
async function setup() {
  $('setup').style.display = 'block';
  const f = (id) => $(id);
  const store = { get() { try { return JSON.parse(localStorage.getItem('portal-setup') || '{}'); } catch { return {}; } },
    set(v) { try { localStorage.setItem('portal-setup', JSON.stringify(v)); } catch {} } };
  const saved = store.get();

  // Clocks
  const tick = () => { const p = clockParts(); f('s-clock').innerHTML = p.map(([n, t, d]) => `<span>${n} <b>${t}</b> ${p[0][2] !== p[1][2] ? d : ''}</span>`).join(''); };
  tick(); setInterval(tick, 15000);

  // Camera + mic preview, with a live mic level bar.
  let stream, actx, meterRaf;
  const startMeter = () => {
    cancelAnimationFrame(meterRaf);
    const tr = stream?.getAudioTracks()[0]; if (!tr) return;
    actx = actx || new AudioContext();
    const an = actx.createAnalyser(); an.fftSize = 512;
    actx.createMediaStreamSource(new MediaStream([tr])).connect(an);
    const buf = new Uint8Array(an.fftSize); let heard = 0;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      const lvl = Math.min(1, peak / 64);
      f('s-meter').style.width = `${Math.round(lvl * 100)}%`;
      if (lvl > 0.25 && ++heard === 8) f('s-meter-help').textContent = '✓ We can hear you.';
      meterRaf = requestAnimationFrame(loop);
    };
    loop();
  };
  const openMedia = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: f('s-cam').value ? { deviceId: { exact: f('s-cam').value } } : true,
        audio: f('s-mic').value ? { deviceId: { exact: f('s-mic').value } } : true,
      });
      f('s-preview').srcObject = stream; startMeter();
    } catch (e) {
      f('s-meter-help').textContent = `The browser couldn’t open the camera or mic (${e.name}). Allow access in the address bar, then reload.`;
    }
  };
  await openMedia();
  document.addEventListener('pointerdown', () => actx?.resume(), { once: true });

  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind) => devs.filter((d) => d.kind === kind && d.deviceId !== 'default').forEach((d, i) => {
    const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `${kind} ${i + 1}`; f(sel).appendChild(o);
  });
  fill('s-cam', 'videoinput'); fill('s-mic', 'audioinput'); fill('s-spk', 'audiooutput');
  if (!HTMLMediaElement.prototype.setSinkId) f('s-spk').disabled = true;

  // Test sound through the chosen speaker.
  f('s-test').onclick = async () => {
    actx = actx || new AudioContext(); await actx.resume();
    const dest = actx.createMediaStreamDestination(), g = actx.createGain();
    g.connect(dest); g.gain.value = 0.0001;
    const el = new Audio(); el.srcObject = dest.stream;
    if (f('s-spk').value && el.setSinkId) try { await el.setSinkId(f('s-spk').value); } catch {}
    el.play();
    const t0 = actx.currentTime + 0.05;
    [523.25, 659.25, 783.99].forEach((hz, i) => { const o = actx.createOscillator(); o.frequency.value = hz; o.connect(g); o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 0.16); });
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03); g.gain.setValueAtTime(0.25, t0 + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    setTimeout(() => el.pause(), 1200);
  };

  // Frames, as one-tap buttons grouped by campus (drives the hidden #s-theme select).
  const themes = await loadThemes();
  for (const t of themes) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; f('s-theme').appendChild(o); }
  const drawFrames = () => {
    const box = f('s-frames'); box.innerHTML = '';
    const groups = new Map();
    for (const t of [...themes, { id: '', name: 'Full screen (no frame)', group: 'Other' }]) { const g = t.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
    for (const g of [...groups.keys()].sort((a, b) => (a === 'Other') - (b === 'Other'))) {
      const h = document.createElement('h4'); h.textContent = g; box.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'fgrid'; box.appendChild(grid);
      for (const t of groups.get(g)) {
        const b = document.createElement('button'); b.type = 'button'; b.className = t.id === f('s-theme').value ? 'on' : '';
        const sw = document.createElement('span'); sw.className = 'sw';
        sw.style.background = themeCss(t.base || '', t.swatch || t.border?.gradient || t.border?.color || t.background || '#000');
        if (!t.id) sw.style.border = '1px solid #3b4b5e';
        const nm = document.createElement('span'); nm.textContent = t.name;
        b.append(sw, nm); b.onclick = () => { f('s-theme').value = t.id; drawFrames(); build(); };
        grid.appendChild(b);
      }
    }
  };

  // Campus choice: fills in the name and a matching frame (unless someone already changed them).
  const CAMPUS = {
    ue: { label: 'University of Evansville', theme: 'ue-frame', accent: '#f47b20' },
    hx: { label: 'Harlaxton College', theme: 'harlaxton-frame', accent: '#d9a5c3' },
  };
  let campus = '';
  const pickCampus = (c, keep) => {
    const prev = CAMPUS[campus]; campus = c; const cur = CAMPUS[c];
    document.querySelectorAll('#setup .campus button').forEach((b) => b.classList.toggle('on', b.dataset.campus === c));
    if (!cur) return;
    document.getElementById('setup').style.setProperty('--accent', cur.accent);
    if (!keep) {
      if (!f('s-label').value || f('s-label').value === prev?.label) f('s-label').value = cur.label;
      if (!f('s-theme').value || f('s-theme').value === prev?.theme) f('s-theme').value = cur.theme;
    }
    drawFrames(); build();
  };
  document.querySelectorAll('#setup .campus button').forEach((b) => (b.onclick = () => pickCampus(b.dataset.campus)));

  const build = () => {
    const p = new URLSearchParams();
    p.set('room', f('s-room').value.trim() || 'portal');
    if (f('s-key').value.trim()) p.set('key', f('s-key').value.trim());
    if (f('s-label').value) p.set('label', f('s-label').value);
    p.set('res', f('s-res').value);
    if (f('s-fps').value !== '30') p.set('fps', f('s-fps').value);
    if (f('s-bitrate').value) p.set('bitrate', f('s-bitrate').value);
    if (f('s-cam').value) p.set('cam', f('s-cam').value);
    if (f('s-mic').value) p.set('mic', f('s-mic').value);
    if (f('s-spk').value) p.set('spk', f('s-spk').value);
    if (f('s-codec').value) p.set('codec', f('s-codec').value);
    if (f('s-theme').value) p.set('theme', f('s-theme').value);
    if (f('s-orient').value) p.set('orient', f('s-orient').value);
    if (f('s-rotate').value !== '0') p.set('rotate', f('s-rotate').value);
    if (!f('s-self').checked) p.set('self', '0');
    if (!f('s-clocks').checked) p.set('clocks', '0');
    if (f('s-cclang').value) p.set('cclang', f('s-cclang').value);
    const sl = `${f('s-sleep-from').value || '19:00'}-${f('s-sleep-to').value || '05:00'}`;
    if (!f('s-sleep').checked) p.set('sleep', 'off'); else if (sl !== '19:00-05:00') p.set('sleep', sl);
    if (f('s-contain').checked) p.set('fit', 'contain');
    if (f('s-stats').checked) p.set('stats', '1');
    const url = `${location.origin}${location.pathname}?${p}`;
    f('s-url').textContent = url;
    store.set({ campus, room: f('s-room').value, key: f('s-key').value.trim(), label: f('s-label').value, res: f('s-res').value, fps: f('s-fps').value,
      bitrate: f('s-bitrate').value, codec: f('s-codec').value, rotate: f('s-rotate').value, theme: f('s-theme').value, orient: f('s-orient').value,
      cam: f('s-cam').value, mic: f('s-mic').value, spk: f('s-spk').value,
      sleep: f('s-sleep').checked, sleepFrom: f('s-sleep-from').value, sleepTo: f('s-sleep-to').value,
      cclang: f('s-cclang').value,
      self: f('s-self').checked, clocks: f('s-clocks').checked, contain: f('s-contain').checked, stats: f('s-stats').checked });
    return url;
  };
  // Restore the last setup used on this computer (or a ?key= in the setup link).
  for (const [id, k] of [['s-room', 'room'], ['s-key', 'key'], ['s-label', 'label'], ['s-res', 'res'], ['s-fps', 'fps'], ['s-bitrate', 'bitrate'], ['s-codec', 'codec'], ['s-rotate', 'rotate'], ['s-theme', 'theme'], ['s-orient', 'orient'], ['s-sleep-from', 'sleepFrom'], ['s-sleep-to', 'sleepTo'], ['s-cclang', 'cclang']]) {
    if (saved[k] == null) continue;
    if (f(id).tagName !== 'SELECT' || [...f(id).options].some((o) => o.value === String(saved[k]))) f(id).value = saved[k];
  }
  for (const [id, k] of [['s-cam', 'cam'], ['s-mic', 'mic'], ['s-spk', 'spk']]) if (saved[k] && [...f(id).options].some((o) => o.value === saved[k])) f(id).value = saved[k];
  for (const [id, k] of [['s-self', 'self'], ['s-clocks', 'clocks'], ['s-sleep', 'sleep'], ['s-contain', 'contain'], ['s-stats', 'stats']]) if (saved[k] != null) f(id).checked = saved[k];
  if (Q.get('key')) f('s-key').value = Q.get('key');
  pickCampus(saved.campus || '', true);
  if (saved.cam || saved.mic) openMedia();

  document.querySelectorAll('#setup input, #setup select').forEach((el) => el.addEventListener('input', build));
  f('s-cam').addEventListener('change', openMedia);
  f('s-mic').addEventListener('change', openMedia);
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
        st.textContent = ok ? (f('s-key').value.trim() ? '✓ Key accepted' : '✓ No key needed on this server') : (f('s-key').value.trim() ? '✗ That key doesn’t match. Check for typos (1 vs l, 0 vs O) and extra spaces.' : 'Type the room key to continue.');
        f('s-go').disabled = !ok;
        f('s-go-help').textContent = ok ? 'The portal opens and connects by itself as soon as the other campus is on. Bookmark the next page to skip this setup next time.' : 'Enter the room key (step 2) to start.';
      } catch { st.textContent = ''; }
    }, 300);
  };
  f('s-key').addEventListener('input', checkKey);
  checkKey();
  drawFrames();
  build();
  f('s-go').onclick = () => {
    stream?.getTracks().forEach((t) => t.stop());
    const url = build();
    location.href = url;
  };
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
    res: PRESETS[Q.get('res')] ? Q.get('res') : '720',
    preset: PRESETS[Q.get('res')] || PRESETS[720],
    fps: Number(Q.get('fps') || 30),
    kbps: Number(Q.get('bitrate') || 0),
    codec: (Q.get('codec') || '').toUpperCase(),
    jitterMs: Q.has('jb') ? Number(Q.get('jb')) : null, // null = browser default (adaptive, lowest safe delay)
    avsync: Number(Q.get('avsync') || 0),  // manual lip-sync trim in ms: + delays audio, − delays video
    autosync: Q.get('autosync') !== '0',   // match audio delay to measured video delay
    relay: Q.get('relay') === '1',         // force traffic through the TURN relay (for testing)
    cam: Q.get('cam'), mic: Q.get('mic'), spk: Q.get('spk'),
  };
  cfg.kbpsAuto = !cfg.kbps;
  cfg.kbps = cfg.kbps || autoKbps(cfg.preset, cfg.fps);
  if (Q.get('self') === '0') document.body.classList.add('no-self');
  if (Q.get('fit') === 'contain') document.body.classList.add('fit-contain');
  if (Q.get('stats') === '1') document.body.classList.add('show-stats');
  if (Q.get('clocks') === '0') document.body.classList.add('no-clocks');

  // ---------- Clocks (both campuses) ----------
  const drawClocks = () => {
    const p = clockParts(), diffDay = p[0][2] !== p[1][2];
    $('clocks').innerHTML = p.map(([n, t, d]) => `<span class="c"><span class="n">${n}</span><span class="t">${t}</span>${diffDay ? `<span class="d">${d}</span>` : ''}</span>`).join('');
  };
  drawClocks(); setInterval(drawClocks, 10000);

  // ---------- Orientation ----------
  view.orient = ['landscape', 'portrait'].includes(Q.get('orient')) ? Q.get('orient') : '';
  view.rotate = [90, 270].includes(Number(Q.get('rotate'))) ? Number(Q.get('rotate')) : 0;
  function setView(orient, rotate) {
    view.orient = orient; view.rotate = rotate;
    setParam('orient', orient || null); setParam('rotate', rotate || null);
    renderTheme();
    toast(`${orient ? orient[0].toUpperCase() + orient.slice(1) : 'Auto orientation'}${rotate ? ` · rotated ${rotate === 90 ? '90° clockwise' : '90° counter-clockwise'}` : ''}`);
  }
  const cycleOrient = () => setView({ '': 'landscape', landscape: 'portrait', portrait: '' }[view.orient], view.rotate);
  const cycleRotate = () => setView(view.rotate === 0 ? 'portrait' : view.orient, { 0: 90, 90: 270, 270: 0 }[view.rotate]);

  // ---------- Theme ----------
  const themes = await loadThemes();
  cfg.theme = Q.get('theme') || '';
  applyTheme(themes.find((t) => t.id === cfg.theme));
  function setTheme(id) {
    const t = themes.find((x) => x.id === id);
    cfg.theme = t ? id : '';
    applyTheme(t);
    setParam('theme', cfg.theme || null);
    toast(t ? `Theme: ${t.name}` : 'Theme: full screen');
  }
  // Frame picker: one tap per frame, grouped by campus. Works any time, including mid-call.
  function fillFrames() {
    const list = $('f-list'); list.innerHTML = '';
    const groups = new Map();
    for (const t of [{ id: '', name: 'Full screen (no frame)', group: 'Other' }, ...themes]) {
      const g = t.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t);
    }
    const order = [...groups.keys()].sort((a, b) => (a === 'Other') - (b === 'Other'));
    for (const g of order) {
      const h = document.createElement('h4'); h.textContent = g; list.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'fgrid'; list.appendChild(grid);
      for (const t of groups.get(g)) {
        const b = document.createElement('button'); b.className = 'fbtn' + (t.id === cfg.theme ? ' on' : '');
        const sw = document.createElement('span'); sw.className = 'sw';
        sw.style.background = themeCss(t.base || '', t.swatch || t.border?.gradient || t.border?.color || t.background || '#000');
        if (!t.swatch && t.border?.innerColor) sw.style.boxShadow = `inset 0 0 0 2px ${t.border.innerColor}`;
        if (!t.id) sw.style.border = '1px solid #3b4b5e';
        const nm = document.createElement('span'); nm.textContent = t.name;
        b.append(sw, nm);
        b.onclick = () => { setTheme(t.id); fillFrames(); };
        grid.appendChild(b);
      }
    }
  }
  const toggleFrames = () => {
    document.body.classList.remove('show-settings');
    if (document.body.classList.toggle('show-frames')) fillFrames();
  };
  $('f-close').onclick = toggleFrames;
  const cycleTheme = () => { const ids = ['', ...themes.map((t) => t.id)]; setTheme(ids[(ids.indexOf(cfg.theme) + 1) % ids.length]); };

  const clientId = crypto.randomUUID();
  const remoteVideo = $('remote'), localVideo = $('local');
  let localStream = null, pc = null, ws = null, polite = false, peerLabel = '';
  let onRemoteState = null, onLinkChange = null, onRemoteWake = null, onCaptionSignal = null; // set up by the controls section below
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let gen = 0; // peer-connection generation; bumps on full rebuild

  // ---------- UI helpers ----------
  const status = (title, sub = '', show = true) => {
    $('ov-title').textContent = title; $('ov-sub').textContent = sub;
    $('overlay').classList.toggle('hidden', !show);
    document.body.classList.toggle('waiting', show);
  };
  document.body.classList.toggle('waiting', !$('overlay').classList.contains('hidden'));
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
  let turnAvailable = false;
  async function fetchIce() {
    const r = await fetch(`/config?key=${encodeURIComponent(cfg.key)}`, { cache: 'no-store' });
    if (r.status === 403) return false;
    const j = await r.json();
    iceServers = j.iceServers; turnAvailable = !!j.turn;
    return true;
  }
  try { if (!(await fetchIce())) return wrongKey(); }
  catch (e) { console.warn('config fetch failed, using default STUN', e); }
  // TURN credentials expire; refresh them on the live connection every 6 hours.
  setInterval(async () => {
    try {
      if (await fetchIce() && pc) pc.setConfiguration({ ...pc.getConfiguration(), iceServers });
    } catch (e) { console.warn('ICE refresh failed', e); }
  }, 6 * 3600 * 1000);

  // ---------- Local media ----------
  // The other site tells us the shape of its portal (wide, tall, round...). We capture that shape so its
  // screen gets a full-resolution picture instead of cropping a strip out of a widescreen one.
  let remoteAspect = null;
  const videoShape = () => {
    const a = remoteAspect ? Math.min(16 / 9, Math.max(9 / 16, remoteAspect)) : 16 / 9;
    if (Math.abs(Math.log(a / (16 / 9))) < 0.06) return { width: { ideal: cfg.preset.w }, height: { ideal: cfg.preset.h }, frameRate: { ideal: cfg.fps, max: cfg.fps } };
    // Crop from the camera's full height (cameras are landscape), so a tall portal gets every pixel of height.
    const h = cfg.preset.h, w = Math.round(h * a);
    return { width: { exact: w }, height: { exact: h }, resizeMode: 'crop-and-scale', frameRate: { ideal: cfg.fps, max: cfg.fps } };
  };
  // Same shape, but with "ideal" sizes: used to open a camera (any camera opens), and as the fallback
  // when a camera can't produce the exact crop.
  const softShape = () => { const v = videoShape(); for (const k of ['width', 'height']) if (v[k]?.exact) v[k] = { ideal: v[k].exact }; return v; };
  async function applyShape(vt) {
    try { await vt.applyConstraints(videoShape()); return true; }
    catch { try { await vt.applyConstraints(softShape()); return true; } catch (e) { console.warn('capture shape', e.message); return false; } }
  }
  async function adaptCapture() {
    const vt = localStream?.getVideoTracks()[0];
    if (!vt) return;
    await applyShape(vt);
    tuneSenders(); showActual?.();
  }
  // Tell the other side our portal's shape (on connect, and whenever the layout changes).
  let sentAspect = null, shapeTimer;
  const sendView = (force) => {
    if (!pc || pc.connectionState !== 'connected') return;
    if (!force && sentAspect && Math.abs(stageAspect / sentAspect - 1) < 0.02) return;
    sentAspect = stageAspect; signal({ view: { aspect: Math.round(stageAspect * 1000) / 1000 } });
  };
  onStageShape = () => { clearTimeout(shapeTimer); shapeTimer = setTimeout(() => sendView(false), 400); };
  const videoConstraints = (exact) => ({ ...softShape(), ...(cfg.cam ? { deviceId: exact ? { exact: cfg.cam } : { ideal: cfg.cam } } : {}) });
  const audioConstraints = (exact) => ({
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    channelCount: 1, sampleRate: 48000,
    ...(cfg.mic ? { deviceId: exact ? { exact: cfg.mic } : { ideal: cfg.mic } } : {}),
  });
  function prepTrack(t) {
    t.contentHint = t.kind === 'video' ? 'motion' : 'speech';
    t.addEventListener('ended', onTrackEnded);
    return t;
  }
  async function getMedia() {
    for (;;) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(false), audio: audioConstraints(false) });
        s.getTracks().forEach(prepTrack);
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

  // ---------- Switching devices / quality during a call ----------
  // A new track is swapped into the existing sender with replaceTrack, so the call never renegotiates
  // or drops: the other site just sees the new camera (or hears the new mic) a moment later.
  async function swapTrack(kind, getTrack) {
    const old = kind === 'video' ? localStream.getVideoTracks()[0] : localStream.getAudioTracks()[0];
    let nt;
    try { nt = await getTrack(); }
    catch (e) {
      // Some cameras can only be opened once: release the old one and try again.
      if (!old || !['NotReadableError', 'AbortError', 'TrackStartError'].includes(e.name)) throw e;
      old.stop();
      try { nt = await getTrack(); }
      catch (e2) {
        // Couldn't open the new device either: get any working device back so the feed doesn't die.
        nt = (await navigator.mediaDevices.getUserMedia(kind === 'video' ? { video: videoShape() } : { audio: true }))[kind === 'video' ? 'getVideoTracks' : 'getAudioTracks']()[0];
        setTimeout(() => toast(`Couldn’t open that ${kind === 'video' ? 'camera' : 'microphone'} (${e2.name})`), 50);
      }
    }
    prepTrack(nt);
    nt.enabled = kind === 'video' ? camOn : micOn;
    const sender = pc?.getSenders().find((x) => x.track === old || x.track?.kind === kind);
    if (sender) await sender.replaceTrack(nt);
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(nt);
    localVideo.srcObject = localStream;
    return nt;
  }
  const setParam = (k, v) => {
    const u = new URL(location.href);
    if (v == null || v === '') u.searchParams.delete(k); else u.searchParams.set(k, v);
    history.replaceState(null, '', u);
  };
  async function switchCamera(id) {
    cfg.cam = id || null; setParam('cam', id);
    const nt = await swapTrack('video', async () => (await navigator.mediaDevices.getUserMedia({ video: videoConstraints(true) })).getVideoTracks()[0]);
    await applyShape(nt);
    tuneSenders(); showActual();
    toast('Camera switched');
  }
  async function switchMic(id) {
    cfg.mic = id || null; setParam('mic', id);
    await swapTrack('audio', async () => (await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(true) })).getAudioTracks()[0]);
    toast('Microphone switched');
  }
  async function switchSpeaker(id) {
    cfg.spk = id || null; setParam('spk', id);
    if (remoteVideo.setSinkId) await remoteVideo.setSinkId(id || '');
    toast('Speaker switched');
  }
  async function setQuality({ res = cfg.res, fps = cfg.fps, kbps = cfg.kbpsAuto ? 0 : cfg.kbps }) {
    cfg.res = String(res); cfg.preset = PRESETS[cfg.res]; cfg.fps = Number(fps);
    cfg.kbpsAuto = !Number(kbps); cfg.kbps = Number(kbps) || autoKbps(cfg.preset, cfg.fps);
    setParam('res', cfg.res); setParam('fps', cfg.fps === 30 ? null : cfg.fps); setParam('bitrate', cfg.kbpsAuto ? null : cfg.kbps);
    const vt = localStream.getVideoTracks()[0];
    if (!(await applyShape(vt))) await applyShape(await swapTrack('video', async () => (await navigator.mediaDevices.getUserMedia({ video: videoConstraints(true) })).getVideoTracks()[0]));
    await tuneSenders(); showActual();
    toast(`${cfg.res}p · ${cfg.fps} fps · up to ${(cfg.kbps / 1000).toFixed(1)} Mbps`);
  }
  // What the camera actually delivers (cameras often can't do every size/rate asked for).
  function showActual() {
    const st = localStream.getVideoTracks()[0]?.getSettings() || {};
    const el = $('p-actual');
    if (el) el.textContent = st.width ? `Camera is sending ${st.width}×${st.height} at ${Math.round(st.frameRate || 0)} fps` + (st.frameRate && st.frameRate < cfg.fps - 1 ? ' (camera limit; more light can help)' : '') : '';
  }

  status('Starting camera…');
  localStream = await getMedia();
  localVideo.srcObject = localStream;
  if (cfg.spk && remoteVideo.setSinkId) remoteVideo.setSinkId(cfg.spk).catch((e) => console.warn('setSinkId', e));

  // ---------- Signaling (WebSocket with auto-reconnect) ----------
  let wsBackoff = 500, lastPong = Date.now();
  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const p = new URLSearchParams({ room: cfg.room, id: clientId, label: cfg.label, key: cfg.key });
    ws = new WebSocket(`${proto}://${location.host}/ws?${p}`);
    ws.onopen = () => { wsBackoff = 500; lastPong = Date.now(); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'pong') { lastPong = Date.now(); return; } onWsMessage(m); };
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
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: cfg.relay ? 'relay' : 'all', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 4 });
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
    pc.onicecandidate = ({ candidate }) => { if (candidate) { noteCand(diag.local, candidate.candidate); signal({ candidate }); } };
    pc.onicecandidateerror = (e) => { if (myPc === pc) diag.stunErrors++; };
    resetDiag();

    pc.ontrack = ({ track, streams, receiver }) => {
      tuneReceiver(receiver);
      if (remoteVideo.srcObject !== streams[0]) {
        remoteVideo.srcObject = streams[0];
        remoteVideo.classList.remove('live'); void remoteVideo.offsetWidth; remoteVideo.classList.add('live');
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
        sendView(true);
        tuneSenders();
        onLinkChange?.();
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
  // ---------- Connection diagnosis (shown if "Connecting…" takes too long) ----------
  // Counts which kinds of network addresses each side found, then explains in plain words what's
  // probably blocking the connection.
  const diag = { local: {}, remote: {}, stunErrors: 0, timer: null };
  function noteCand(bag, c) {
    const m = /typ (host|srflx|prflx|relay)/.exec(c || ''); if (!m) return;
    const k = m[1] === 'host' && /\.local /.test(c) ? 'mdns' : m[1];
    bag[k] = (bag[k] || 0) + 1;
  }
  function resetDiag() {
    diag.local = {}; diag.remote = {}; diag.stunErrors = 0; clearTimeout(diag.timer);
    const myPc = pc;
    diag.timer = setTimeout(() => { if (pc === myPc && pc.connectionState !== 'connected') explainStuck(); }, 15000);
  }
  function explainStuck() {
    const L = diag.local, R = diag.remote, has = (o) => Object.keys(o).length > 0;
    const who = peerLabel || 'the other screen';
    let why;
    if (!has(L)) why = 'This computer isn’t finding any network connections for video. On a Mac: System Settings → Privacy & Security → Local Network → turn on Google Chrome, then reload. Also check that the Mac’s firewall isn’t set to block all incoming connections.';
    else if (!has(R)) why = `${who} hasn’t sent its network details yet. Check that it’s online and, if it’s a Mac, that Chrome is allowed under Privacy & Security → Local Network.`;
    else if (!L.srflx && !L.relay) why = 'This network seems to block the internet check that video calls need (UDP to stun.l.google.com:19302). Try a wired connection or a different network, or ask IT to allow outbound UDP.';
    else why = `Both screens found each other but the network is blocking a direct video link. This is common on campus Wi-Fi that keeps devices apart (“client isolation”). Try plugging one or both Macs into Ethernet, or test with one on a phone hotspot.`;
    status('Still connecting…', why);
    console.warn('connect diagnosis', JSON.stringify({ local: L, remote: R, stunErrors: diag.stunErrors }));
  }

  async function rebuild() { try { await fetchIce(); } catch {} closePc(true); createPc(); }

  function closePc(keepUi) {
    clearTimeout(watchdog); watchdog = null; clearTimeout(discTimer);
    if (pc) { pc.onnegotiationneeded = pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); }
    pc = null;
    if (!keepUi) remoteVideo.srcObject = null;
    onLinkChange?.();
  }

  async function onSignal(data) {
    if (data.state) return onRemoteState?.(data.state);
    if (data.wake) return onRemoteWake?.(data.wake);
    if (data.cc || data.ccWant !== undefined || data.ccErr) return onCaptionSignal?.(data);
    if (data.view) { remoteAspect = Number(data.view.aspect) || null; return adaptCapture(); }
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
      noteCand(diag.remote, candidate.candidate);
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

  // Receivers are kept so lip sync can adjust their playout delay while the call runs.
  let audioRx = null, videoRx = null;
  function tuneReceiver(receiver) {
    if (receiver.track.kind === 'audio') audioRx = receiver; else videoRx = receiver;
    setTarget(receiver, receiver === videoRx ? videoBase() : null);
  }
  const videoBase = () => Math.max(cfg.jitterMs ?? 0, cfg.avsync < 0 ? -cfg.avsync : 0) || null;
  function setTarget(receiver, ms) {
    try {
      if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = ms;
      else if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = ms == null ? null : ms / 1000;
    } catch (e) { console.warn('playout delay', e); }
  }

  // ---------- Lip sync ----------
  // WebRTC already lines audio up with video using RTCP timestamps, but delay it cannot see (a slow
  // camera, a busy decoder, video queued behind loss recovery) can still leave audio ahead. Each second
  // we measure how long video spends between arriving and being decoded, and hold audio for at least
  // that long. cfg.avsync adds a manual trim on top for camera/capture latency on the sending side.
  let syncVideoMs = null, appliedAudioMs = null;
  function updateSync(videoDelayMs) {
    if (videoDelayMs != null && isFinite(videoDelayMs)) syncVideoMs = syncVideoMs == null ? videoDelayMs : syncVideoMs * 0.7 + videoDelayMs * 0.3;
    if (!audioRx) return;
    const want = Math.max(0, Math.min(2000, (cfg.autosync && syncVideoMs != null ? syncVideoMs : 0) + Math.max(0, cfg.avsync)));
    const target = want < 10 ? null : Math.round(want);
    if (target === appliedAudioMs || (target != null && appliedAudioMs != null && Math.abs(target - appliedAudioMs) < 15)) return;
    setTarget(audioRx, target); appliedAudioMs = target;
  }
  function nudgeSync(delta) {
    cfg.avsync = Math.max(-1000, Math.min(1000, cfg.avsync + delta));
    if (videoRx) setTarget(videoRx, videoBase());
    appliedAudioMs = undefined; updateSync(null);
    const u = new URL(location.href);
    if (cfg.avsync) u.searchParams.set('avsync', cfg.avsync); else u.searchParams.delete('avsync');
    history.replaceState(null, '', u);
    toast(cfg.avsync === 0 ? 'Lip sync: automatic' : cfg.avsync > 0 ? `Audio delayed ${cfg.avsync} ms` : `Video delayed ${-cfg.avsync} ms`);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
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
  let micOn = true, camOn = true, sleeping = false;
  // Captions: cc.iWant = we want to see the other side's speech as text; cc.peerWants = they want ours.
  const cc = { rec: null, peerWants: false, iWant: Q.get('cc') === '1', fatal: false, backoff: 1000, lastInterim: 0, lang: Q.get('cclang') || '' };
  function applyMuteState() {
    localStream.getAudioTracks().forEach((t) => (t.enabled = micOn && !sleeping));
    localStream.getVideoTracks().forEach((t) => (t.enabled = camOn && !sleeping));
    remoteVideo.muted = sleeping; // no sound from the other side overnight
    $('b-mic').classList.toggle('off', !micOn); $('b-mic').textContent = micOn ? 'Mic' : 'Mic off';
    $('b-cam').classList.toggle('off', !camOn); $('b-cam').textContent = camOn ? 'Camera' : 'Camera off';
    localVideo.style.opacity = camOn ? 1 : 0.25;
    sendState(); renderNotices(); syncRec();
  }
  // Mute notices: our own mic/camera state, and the other campus's (sent over the signaling channel).
  let remoteState = null;
  function renderNotices() {
    const live = pc && pc.connectionState === 'connected';
    const who = peerLabel || 'The other campus';
    const rSleep = live && remoteState?.sleep;
    const rMicOff = live && !rSleep && remoteState && remoteState.mic === false, rCamOff = live && remoteState && (rSleep || remoteState.cam === false);
    $('n-remote-mic-text').textContent = `${who} is muted`;
    $('n-remote-mic').classList.toggle('on', !!rMicOff && !sleeping);
    $('cam-off-text').textContent = rSleep ? `${who}’s portal is asleep` : `${who} turned their camera off`;
    $('cam-off').classList.toggle('on', !!rCamOff);
    $('n-my-mic').classList.toggle('on', !micOn);
    $('n-my-cam').classList.toggle('on', !camOn);
    $('n-my-cc').classList.toggle('on', !!cc.rec && !sleeping);
  }
  function sendState() { signal({ state: { mic: micOn, cam: camOn, sleep: sleeping } }); }
  onRemoteState = (st) => { remoteState = st; renderNotices(); };
  onLinkChange = () => { if (!(pc && pc.connectionState === 'connected')) remoteState = null; else sendState(); renderNotices(); };
  const toggleMic = () => { micOn = !micOn; applyMuteState(); };
  const toggleCam = () => { camOn = !camOn; applyMuteState(); };

  // ---------- Captions ----------
  // The browser's speech-to-text can only listen to a microphone on this computer, so each kiosk
  // transcribes its OWN mic and sends the words to the other side, which shows them. A viewer turns
  // captions on, that tells the other kiosk to start transcribing, and its words appear here.
  // Uses Chrome/Edge's built-in speech service (audio goes to Google/Microsoft while captions are on).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Local names speech recognition often gets wrong, and the usual ways it mishears them.
  const CC_WORDS = ['Harlaxton', 'Evansville', 'Grantham', 'Lincolnshire', 'Purple Aces', 'Ridgway', 'Ace Purple'];
  const CC_FIXES = [
    [/\b(?:hard|har|hal|car)\s*la(?:x|ks|cks)\s*ton\b/gi, 'Harlaxton'], [/\bharlaxton\b/gi, 'Harlaxton'],
    [/\bevans?\s*ville\b/gi, 'Evansville'], [/\bgrant\s*ham\b/gi, 'Grantham'], [/\blincoln\s*shire\b/gi, 'Lincolnshire'],
    [/\bridge\s*way\b/gi, 'Ridgway'],
  ];
  const fixWords = (t) => CC_FIXES.reduce((s, [re, w]) => s.replace(re, w), t);
  function syncRec() {
    const want = cc.peerWants && micOn && !sleeping && healthy() && !cc.fatal;
    if (want && !cc.rec) startRec(); else if (!want && cc.rec) stopRec();
    $('n-my-cc')?.classList.toggle('on', !!cc.rec && !sleeping);
  }
  function startRec() {
    if (!SR) { signal({ ccErr: 'unsupported' }); cc.fatal = true; return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true;
    // The accent model matters most for accuracy: set it to how people speak at THIS screen.
    rec.lang = cc.lang || navigator.language || 'en-US';
    // Newer Chrome can be told which unusual words to expect.
    try { if ('phrases' in rec && window.SpeechRecognitionPhrase) rec.phrases = CC_WORDS.map((w) => new SpeechRecognitionPhrase(w, 5)); } catch {}
    rec.onresult = (e) => {
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript; }
      if (fin.trim()) signal({ cc: { t: fixWords(fin.trim()), f: 1 } });
      else if (interim.trim() && Date.now() - cc.lastInterim > 250) { cc.lastInterim = Date.now(); signal({ cc: { t: fixWords(interim.trim()), f: 0 } }); }
      cc.backoff = 1000;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') { cc.fatal = true; signal({ ccErr: e.error }); }
      else if (e.error === 'network') cc.backoff = Math.min(cc.backoff * 2, 30000);
    };
    rec.onend = () => { // the service stops after pauses or errors; keep it going while captions are wanted
      if (cc.rec !== rec) return;
      cc.rec = null;
      setTimeout(syncRec, cc.backoff);
    };
    cc.rec = rec;
    // Prefer our echo-cancelled mic track (newer Chrome); older browsers ignore it and use the default mic.
    const tr = localStream.getAudioTracks()[0];
    try { rec.start(tr); } catch { try { rec.start(); } catch (err) { cc.rec = null; console.warn('captions', err); } }
  }
  function stopRec() { const r = cc.rec; cc.rec = null; if (r) { r.onend = null; try { r.abort(); } catch {} } }

  // Receiving side: show the other campus's words.
  let ccHide, ccLines = [];
  function showCaption({ t, f }) {
    const box = $('captions');
    if (f) { ccLines = [...ccLines, t].slice(-2); box.querySelector('.cc-live').textContent = ''; }
    else box.querySelector('.cc-live').textContent = t;
    // Keep it to about two lines on screen: show the newest words, trimming the oldest.
    let done = ccLines.join(' '); const live = box.querySelector('.cc-live').textContent, max = 150;
    if (done.length + live.length > max) { const keep = Math.max(0, max - live.length); done = done.length > keep ? '… ' + done.slice(done.length - keep).replace(/^\S*\s/, '') : done; }
    box.querySelector('.cc-done').textContent = done;
    box.classList.add('on');
    clearTimeout(ccHide); ccHide = setTimeout(() => { box.classList.remove('on'); ccLines = []; }, 7000);
  }
  function setCaptions(on, quiet) {
    cc.iWant = on;
    setParam('cc', on ? '1' : null);
    $('b-cc').classList.toggle('on', on);
    $('b-cc').textContent = on ? 'Captions on' : 'Captions';
    if (!on) { $('captions').classList.remove('on'); ccLines = []; }
    signal({ ccWant: on });
    if (!quiet) toast(on ? (healthy() ? 'Captions on' : 'Captions on (they’ll start when the other campus connects)') : 'Captions off');
  }
  onCaptionSignal = (d) => {
    if (d.ccWant !== undefined) { cc.peerWants = !!d.ccWant; if (!cc.peerWants) cc.fatal = false; syncRec(); return; }
    if (d.ccErr) { if (cc.iWant) toast(d.ccErr === 'unsupported' ? 'Captions aren’t available in the other campus’s browser (use Chrome or Edge there)' : `Captions couldn’t start on the other side (${d.ccErr})`); return; }
    if (d.cc && cc.iWant && typeof d.cc.t === 'string') showCaption({ t: d.cc.t.slice(0, 300), f: !!d.cc.f });
  };
  { const prev = onLinkChange; onLinkChange = () => { prev(); if (healthy()) signal({ ccWant: cc.iWant }); else { cc.peerWants = false; } syncRec(); }; }
  const toggleCaptions = () => setCaptions(!cc.iWant);
  setCaptions(cc.iWant, true);

  // ---------- Sleep mode ----------
  // Both kiosks follow the same schedule in Evansville time, so they go to sleep and wake up together.
  // While asleep the call stays connected (so waking is instant), but the camera and mic send nothing,
  // the other side's sound is muted, and the screen shows a dim clock. sleep=HH:MM-HH:MM or sleep=off.
  const SLEEP_TZ = 'America/Chicago';
  const parseSleep = (v) => {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(v || '');
    return m ? { from: +m[1] * 60 + +m[2], to: +m[3] * 60 + +m[4] } : null;
  };
  const fmtHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  let sleepCfg = Q.get('sleep') === 'off' ? null : parseSleep(Q.get('sleep') || '19:00-05:00');
  let wakeUntil = 0; // a manual "wake up" lasts until this time
  const tzFmt = new Intl.DateTimeFormat('en-US', { timeZone: SLEEP_TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const minutesIn = (d) => { const p = Object.fromEntries(tzFmt.formatToParts(d).map((x) => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; };
  const inSleep = (d) => {
    if (!sleepCfg || sleepCfg.from === sleepCfg.to) return false;
    const m = minutesIn(d), { from, to } = sleepCfg;
    return from < to ? m >= from && m < to : m >= from || m < to;
  };
  const nextWake = () => { let t = Math.ceil(Date.now() / 60000) * 60000; for (let i = 0; i < 1500 && inSleep(new Date(t)); i++) t += 60000; return new Date(t); };
  const timeIn = (d, tz) => d.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  function drawSleep() {
    const p = clockParts();
    $('sl-clocks').innerHTML = p.map(([n, t]) => `<div><span>${n}</span><b>${t}</b></div>`).join('');
    const w = nextWake();
    $('sl-msg').textContent = wakeUntil > Date.now() ? '' : `Wakes up at ${timeIn(w, 'America/Chicago')} in Evansville · ${timeIn(w, 'Europe/London')} at Harlaxton`;
    // drift a little each minute so nothing burns into the screen
    $('sl-inner').style.transform = `translate(${Math.round(Math.random() * 8 - 4)}cqw, ${Math.round(Math.random() * 8 - 4)}cqh)`;
  }
  function checkSleep() {
    const want = inSleep(new Date()) && Date.now() > wakeUntil;
    if (want !== sleeping) {
      sleeping = want;
      document.body.classList.toggle('sleeping', sleeping);
      applyMuteState();
      toast(sleeping ? 'Portal is going to sleep' : 'Good morning! Portal is awake');
    }
    if (sleeping) drawSleep();
    $('b-sleep').textContent = sleepCfg ? (sleeping ? 'Wake up' : 'Sleep: on') : 'Sleep: off';
  }
  const wakeFor = (ms, fromPeer) => {
    wakeUntil = Math.max(wakeUntil, Date.now() + ms);
    if (!fromPeer) signal({ wake: wakeUntil });
    checkSleep();
    toast(`Awake until ${new Date(wakeUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  };
  onRemoteWake = (until) => { if (until > wakeUntil && until - Date.now() < 3 * 3600e3) wakeFor(until - Date.now(), true); };
  $('sl-wake').onclick = () => wakeFor(30 * 60e3);
  $('b-sleep').onclick = () => { if (sleeping) wakeFor(30 * 60e3); else { document.body.classList.remove('show-frames'); if (!document.body.classList.contains('show-settings')) toggleSettings(); } };
  const setSleepCfg = (on, from, to) => {
    sleepCfg = on ? parseSleep(`${from}-${to}`) : null;
    setParam('sleep', !sleepCfg ? 'off' : (`${from}-${to}` === '19:00-05:00' ? null : `${from}-${to}`));
    wakeUntil = 0; checkSleep();
  };
  setInterval(checkSleep, 15000);
  checkSleep();
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
  // ---------- Settings panel ----------
  async function fillDevices() {
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
    const cur = { videoinput: localStream.getVideoTracks()[0]?.getSettings().deviceId, audioinput: localStream.getAudioTracks()[0]?.getSettings().deviceId, audiooutput: remoteVideo.sinkId || '' };
    const fill = (sel, kind) => {
      const el = $(sel); el.innerHTML = '';
      const list = devs.filter((d) => d.kind === kind);
      if (kind === 'audiooutput') { const o = document.createElement('option'); o.value = ''; o.textContent = 'System default'; el.appendChild(o); }
      list.forEach((d, i) => { if (kind === 'audiooutput' && d.deviceId === 'default') return; const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `${kind} ${i + 1}`; el.appendChild(o); });
      el.value = cur[kind] ?? '';
      el.disabled = kind === 'audiooutput' && !remoteVideo.setSinkId;
    };
    fill('p-cam', 'videoinput'); fill('p-mic', 'audioinput'); fill('p-spk', 'audiooutput');
    const th = $('p-theme'); th.innerHTML = '';
    [{ id: '', name: 'Full screen (no border)' }, ...themes].forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; th.appendChild(o); });
    th.value = cfg.theme;
    $('p-clocks').checked = !document.body.classList.contains('no-clocks');
    $('p-cclang').value = cc.lang;
    $('p-sleep').checked = !!sleepCfg; $('p-sleep-from').value = fmtHM(sleepCfg?.from ?? 1140); $('p-sleep-to').value = fmtHM(sleepCfg?.to ?? 300);
    $('p-orient').value = view.orient; $('p-rotate').value = String(view.rotate);
    $('p-res').value = cfg.res; $('p-fps').value = String(cfg.fps); $('p-bitrate').value = cfg.kbpsAuto ? '0' : String(cfg.kbps);
    if (![...$('p-bitrate').options].some((o) => o.value === $('p-bitrate').value)) { const o = document.createElement('option'); o.value = String(cfg.kbps); o.textContent = `${(cfg.kbps / 1000).toFixed(1)} Mbps`; $('p-bitrate').appendChild(o); $('p-bitrate').value = o.value; }
    showActual();
  }
  const guard = (fn) => async (e) => { const el = e.target; el.disabled = true; try { await fn(el.value); } catch (err) { toast(`Couldn’t switch: ${err.name || err.message}`); fillDevices(); } finally { el.disabled = false; } };
  $('p-theme').onchange = (e) => setTheme(e.target.value);
  const sleepChanged = () => setSleepCfg($('p-sleep').checked, $('p-sleep-from').value || '19:00', $('p-sleep-to').value || '05:00');
  $('p-sleep').onchange = sleepChanged; $('p-sleep-from').onchange = sleepChanged; $('p-sleep-to').onchange = sleepChanged;
  $('p-cclang').onchange = (e) => { cc.lang = e.target.value; setParam('cclang', cc.lang || null); cc.fatal = false; stopRec(); syncRec(); toast(`Caption accent: ${e.target.selectedOptions[0].textContent}`); };
  $('p-clocks').onchange = (e) => { document.body.classList.toggle('no-clocks', !e.target.checked); setParam('clocks', e.target.checked ? null : '0'); };
  $('p-orient').onchange = (e) => setView(e.target.value, view.rotate);
  $('p-rotate').onchange = (e) => setView(view.orient, Number(e.target.value));
  $('p-cam').onchange = guard(switchCamera);
  $('p-mic').onchange = guard(switchMic);
  $('p-spk').onchange = guard(switchSpeaker);
  $('p-res').onchange = guard((v) => setQuality({ res: v }));
  $('p-fps').onchange = guard((v) => setQuality({ fps: v }));
  $('p-bitrate').onchange = guard((v) => setQuality({ kbps: v }));
  const toggleSettings = () => { document.body.classList.remove('show-frames'); const open = document.body.classList.toggle('show-settings'); if (open) fillDevices(); };
  $('p-close').onclick = toggleSettings;
  navigator.mediaDevices.addEventListener?.('devicechange', () => { if (document.body.classList.contains('show-settings')) fillDevices(); });

  $('b-mic').onclick = toggleMic; $('b-cam').onclick = toggleCam; $('b-self').onclick = toggleSelf; $('b-settings').onclick = toggleSettings; $('b-frame').onclick = toggleFrames; $('b-cc').onclick = toggleCaptions; $('b-stats').onclick = toggleStats; $('b-fs').onclick = toggleFs;
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('select, input, textarea')) return; // typing in the panel isn't a shortcut
    const k = e.key.toLowerCase();
    if (k === 'd') return toggleSettings();
    if (k === 'c') return toggleCaptions();
    if (k === 't') { cycleTheme(); if (document.body.classList.contains('show-frames')) fillFrames(); return; }
    if (k === 'escape' && document.body.classList.contains('show-frames')) return toggleFrames();
    if (k === 'o') return cycleOrient();
    if (k === 'r') return cycleRotate();
    if (k === 'escape' && document.body.classList.contains('show-settings')) return toggleSettings();
    if (k === 'm') toggleMic(); else if (k === 'v') toggleCam(); else if (e.key === ']') nudgeSync(20); else if (e.key === '[') nudgeSync(-20); else if (e.key === '\\') { cfg.avsync = 20; nudgeSync(-20); } else if (k === 'h') toggleSelf(); else if (k === 's') toggleStats(); else if (k === 'f') toggleFs();
  });
  remoteVideo.addEventListener('dblclick', toggleFs);

  // Hide cursor + toolbar when idle (kiosk friendly).
  let idle;
  const wake = () => {
    document.body.classList.remove('hide-cursor'); document.body.classList.add('show-ui');
    clearTimeout(idle); idle = setTimeout(() => { if (document.body.matches('.show-settings, .show-frames')) return wake(); document.body.classList.add('hide-cursor'); document.body.classList.remove('show-ui'); }, 3000);
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
    if (!pc || pc.connectionState !== 'connected') return;
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
    // Video's full receive-side delay per frame: first packet in → frame decoded (includes its jitter buffer).
    const vProc = inV && prev.inV && inV.totalProcessingDelay != null && inV.framesDecoded > prev.inV.framesDecoded
      ? ((inV.totalProcessingDelay - prev.inV.totalProcessingDelay) / (inV.framesDecoded - prev.inV.framesDecoded)) * 1000
      : (vJb != null ? vJb + (decMs || 0) : null);
    updateSync(vProc);
    checkFlow(inV, outV, rtt, path);
    if (!document.body.classList.contains('show-stats')) { prev = { inV, inA, outV }; return; }
    const avGap = vProc != null && aJb != null ? Math.round(vProc - aJb) : null;
    // Rough one-way "glass-to-glass": capture+render (~1 frame each) + encode + network + jitter buffer + decode.
    const frame = 1000 / (inV?.framesPerSecond || cfg.fps);
    const est = rtt != null && vJb != null ? Math.round(frame * 2 + (encMs || 5) + rtt / 2 + vJb + (decMs || 5)) : null;

    const codec = inV?.codecId && by[inV.codecId]?.mimeType?.split('/')[1];
    const f = (v, u = '', dp = 0) => (v == null || isNaN(v) ? '–' : v.toFixed(dp) + u);
    $('stats').innerHTML =
`<b>Shape</b>       ${isPortrait() ? 'portrait' : 'landscape'}${view.rotate ? ` (rotated ${view.rotate}°)` : ''} · other side wants ${remoteAspect ? (remoteAspect < 1 ? 'tall' : remoteAspect > 1.1 ? 'wide' : 'square') + ' ' + remoteAspect.toFixed(2) : '–'}
<b>Path</b>        ${path}${cfg.relay ? ' (forced)' : ''}
<b>Relay</b>       ${turnAvailable ? 'TURN configured' : 'STUN only (no relay)'}
<b>RTT</b>         ${f(rtt, ' ms')}
<b>Est. delay</b>  ~${f(est, ' ms')} one-way

<b>Receiving</b>   ${inV ? `${inV.frameWidth || '?'}×${inV.frameHeight || '?'} @ ${f(inV.framesPerSecond)} fps ${codec || ''}` : '–'}
  bitrate     ${kbps(inV, 'inV')} kbps
  loss        ${f(lossPct(inV, 'inV'), ' %', 1)}
  jitter buf  ${f(vJb, ' ms')} video · ${f(aJb, ' ms')} audio
  lip sync    audio ${avGap == null ? '–' : Math.abs(avGap) < 40 ? 'in sync' : avGap > 0 ? `${avGap} ms ahead` : `${-avGap} ms behind`} · trim ${cfg.avsync} ms${cfg.autosync ? ' · auto' : ''}
  decode      ${f(decMs, ' ms', 1)}
  freezes     ${inV?.freezeCount ?? '–'}

<b>Sending</b>     ${outV ? `${outV.frameWidth || '?'}×${outV.frameHeight || '?'} @ ${f(outV.framesPerSecond)} fps` : '–'}
  bitrate     ${kbps(outV, 'outV')} kbps (cap ${cfg.kbps})
  encode      ${f(encMs, ' ms', 1)}
  limited by  ${outV?.qualityLimitationReason || '–'}`;
    prev = { inV, inA, outV };
  }, 1000);

  // ---------- Self-healing, for running 24/7 ----------
  // Each problem gets the gentlest fix first (restart the connection, reopen the camera) and a full page
  // reload only if that doesn't work. A reload happens only when the server is reachable, so the page
  // never swaps itself for a browser error page, and at most a few times an hour so it can't loop.
  const bootAt = Date.now();
  const health = { inFrames: null, inAt: Date.now(), outFrames: null, outAt: Date.now(), netFixes: [], camFixes: [], badSince: null, rtt: null, fps: null, path: '' };
  const recent = (arr) => arr.filter((t) => Date.now() - t < 10 * 60e3);
  async function reloadSoon(reason) {
    console.warn('self-heal: reload —', reason);
    let n = []; try { n = JSON.parse(sessionStorage.getItem('portal-reloads') || '[]').filter((t) => Date.now() - t < 3600e3); } catch {}
    if (n.length >= 4) { console.warn('self-heal: too many reloads this hour, waiting'); return; }
    try { const r = await fetch('/health', { cache: 'no-store' }); if (!r.ok) return; } catch { return; } // server down: keep this page, retry later
    try { sessionStorage.setItem('portal-reloads', JSON.stringify([...n, Date.now()])); } catch {}
    location.reload();
  }
  // Called once a second from the stats loop while connected.
  function checkFlow(inV, outV, rtt, path) {
    const now = Date.now();
    health.rtt = rtt; health.fps = inV?.framesPerSecond ?? null; health.path = path;
    const remoteIdle = sleeping || remoteState?.sleep || remoteState?.cam === false;
    if (inV && inV.framesDecoded !== health.inFrames) { health.inFrames = inV.framesDecoded; health.inAt = now; } else if (remoteIdle) health.inAt = now;
    const localIdle = sleeping || !camOn;
    if (outV && outV.framesEncoded !== health.outFrames) { health.outFrames = outV.framesEncoded; health.outAt = now; } else if (localIdle) health.outAt = now;
    if (now - health.inAt > 20000) { // the other campus's picture has been frozen for 20 s
      health.inAt = now; health.netFixes = [...recent(health.netFixes), now];
      if (health.netFixes.length <= 1) { console.warn('self-heal: video froze, restarting connection'); pc.restartIce(); }
      else reloadSoon('incoming video keeps freezing');
    }
    if (now - health.outAt > 20000) { // our camera stopped producing frames
      health.outAt = now; health.camFixes = [...recent(health.camFixes), now];
      if (health.camFixes.length <= 2) { console.warn('self-heal: camera stalled, reopening it'); onTrackEnded(); }
      else reloadSoon('camera keeps stalling');
    }
  }
  setInterval(() => {
    const now = Date.now();
    // Signaling socket silently dead (no pong for a minute): drop it and reconnect.
    if (ws?.readyState === 1) {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
      if (now - lastPong > 65000) { const old = ws; old.onclose = null; try { old.close(); } catch {} setTimeout(connectWs, 500); lastPong = now; }
    }
    // Stuck: the other campus is there (or the server is unreachable) but we haven't connected for 3 minutes.
    const fine = sleeping || healthy() || (!peerPresent && ws?.readyState === 1);
    if (fine) health.badSince = null; else if (!health.badSince) health.badSince = now; else if (now - health.badSince > 3 * 60e3) { health.badSince = now; reloadSoon('not connected for 3 minutes'); }
    // Report to the status page.
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'report', data: {
      connected: healthy(), sleeping, peer: peerLabel || null, mic: micOn, cam: camOn, fps: health.fps, rtt: health.rtt != null ? Math.round(health.rtt) : null,
      path: health.path, theme: cfg.theme || 'full screen', uptime: Math.round((now - bootAt) / 1000), version: APP_VERSION,
    } }));
  }, 20000);
  // Daily fresh start: reload once a day at 3 AM Evansville time (while asleep, or anyway if sleep is off).
  // Clears any slow memory build-up in the browser and picks up new versions of the portal.
  setInterval(() => {
    const m = minutesIn(new Date());
    if (m >= 180 && m < 195 && Date.now() - bootAt > 6 * 3600e3 && (sleeping || !sleepCfg)) reloadSoon('daily refresh');
  }, 60000);
  // Keep the free server awake (it naps after 15 minutes with no web requests).
  setInterval(() => fetch('/health', { cache: 'no-store' }).catch(() => {}), 4 * 60e3);

  // ---------- Go ----------
  waiting();
  connectWs();

  // If the tab was frozen/backgrounded for a long time, a full reload is the most reliable recovery.
  document.addEventListener('resume', () => location.reload());
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
