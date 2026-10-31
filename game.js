'use strict';
/* =====================================================================
   PANZERPANZER – isometrisches Panzer-Browserspiel
   Steuerung: WASD/Pfeile fahren, Maus zielen, LMT = MG, RMT/Leertaste = Granate
   ===================================================================== */

// ---------------------------------------------------------------- Basics
const TW = 80, TH = 40, HW = TW / 2, HH = TH / 2;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const rotTo = (a, b, s) => { const d = angDiff(a, b); return Math.abs(d) <= s ? b : a + Math.sign(d) * s; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(R, size) {
  const S = size + 1, g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) g[i] = R();
  const at = (a, b) => g[(((b % S) + S) % S) * S + (((a % S) + S) % S)];
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f;
  let v = shadeCache.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  v = `rgb(${r | 0},${g | 0},${b | 0})`;
  shadeCache.set(key, v);
  return v;
}

// ---------------------------------------------------------------- Canvas
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, vignette = null;
const ZOOM = 1.35;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * DPR; canvas.height = innerHeight * DPR;
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  W = innerWidth / ZOOM; H = innerHeight / ZOOM;
  vignette = document.createElement('canvas');
  vignette.width = W; vignette.height = H;
  const v = vignette.getContext('2d');
  const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  v.fillStyle = gr; v.fillRect(0, 0, W, H);
}
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- Zonen
const ZONES = [
  { key: 'desert', name: 'WÜSTE', title: 'Operation Sandsturm',
    brief: 'Eine feindliche Panzerkolonne hat sich an der Oase eingegraben. Vernichte alle Panzer und Bunker, dann setz dich zum Extraktionspunkt ab.',
    ground: ['#d7b677', '#d1af6f', '#cba868', '#dcbd80'], water: '#3c8ea6', bg: '#1d160d',
    rock: '#a8865a', tankCol: '#9b8a62', infCol: '#7d6b49', tanks: 4, inf: 9, bunkers: 2, tint: 'rgba(255,190,90,0.06)' },
  { key: 'forest', name: 'GRENZWALD', title: 'Operation Eisenwald',
    brief: 'Der Gegner hält die Brücken über den Grenzfluss. Säubere den Wald – Bäume kannst du mit dem Panzer einfach umfahren.',
    ground: ['#5e7c39', '#597535', '#668441', '#546f2f'], water: '#3a6d86', bg: '#0f150a',
    rock: '#7c7d74', tankCol: '#5b5f66', infCol: '#3f4636', tanks: 5, inf: 13, bunkers: 3, tint: 'rgba(40,80,20,0.06)' },
  { key: 'bridge', name: 'BRÜCKENKOPF', title: 'Operation Flussübergang',
    brief: 'Die letzte intakte Brücke über den Strom ist in Feindeshand. Am anderen Ufer warten Bunker und Sandsackstellungen. Stoß über die Brücke vor und erobere den Brückenkopf!',
    ground: ['#7d8a4a', '#778445', '#838f50', '#717e40'], water: '#3b6a82', bg: '#10140c',
    rock: '#80796c', tankCol: '#6e6b55', infCol: '#55553f', tanks: 5, inf: 14, bunkers: 4, tint: 'rgba(60,80,40,0.05)' },
  { key: 'city', name: 'RUINENSTADT', title: 'Operation Trümmerfeld',
    brief: 'Häuserkampf. Feindliche Panzer patrouillieren in den Straßenschluchten. Granaten bringen Gebäude zum Einsturz.',
    ground: ['#8a867c', '#837f75', '#8f8b80', '#7d796f'], water: '#3a5d70', bg: '#121212',
    rock: '#77736b', tankCol: '#6b7074', infCol: '#50565c', tanks: 6, inf: 16, bunkers: 4, tint: 'rgba(30,30,40,0.08)' },
  { key: 'snow', name: 'EISFRONT', title: 'Operation Frostbiss',
    brief: 'Letzte Verteidigungslinie im ewigen Eis. Der Feind hat schwere Bunker errichtet. Halte durch, Kommandant.',
    ground: ['#e6edf2', '#dfe7ee', '#eaf0f4', '#d8e2ea'], water: '#5c88a8', bg: '#0c121b',
    rock: '#8c939a', tankCol: '#c4c9ce', infCol: '#cfd4d8', tanks: 8, inf: 14, bunkers: 5, tint: 'rgba(120,170,255,0.07)' },
  { key: 'home', name: 'LONG WAY HOME', title: 'Der lange Weg nach Hause',
    brief: 'Der Krieg ist vorbei – fast. Zwischen dir und der Heimat liegt eine lange Straße durch feindliches Gebiet. Fahr geradeaus nach Norden, durchbrich jede Straßensperre und komm nach Hause. Abschüsse sind optional – ankommen zählt.',
    ground: ['#8a7f45', '#837840', '#90854b', '#7c7239'], water: '#4a6a7a', bg: '#0d0c08', voidCol: '#2c2a19',
    rock: '#7a7468', tankCol: '#5d5a52', infCol: '#4c4a3c', tanks: 8, inf: 20, bunkers: 5, tint: 'rgba(255,140,60,0.07)', exitAlways: true },
];

// ---------------------------------------------------------------- Input
const keys = new Set();
const mouse = { x: 400, y: 300, l: false, r: false };
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) onKey(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('mousemove', e => { mouse.x = e.clientX / ZOOM; mouse.y = e.clientY / ZOOM; });
canvas.addEventListener('mousedown', e => {
  initAudio();
  if (e.button === 0) mouse.l = true;
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { keys.clear(); mouse.l = mouse.r = false; if (G.state === 'play') pauseGame(); });

// ---------------------------------------------------------------- Audio
let AC = null, master = null, noiseBuf = null, engOsc = null, engGain = null, engFilter = null, muted = false;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    engOsc = AC.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 38;
    engFilter = AC.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 180;
    engGain = AC.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter).connect(engGain).connect(master); engOsc.start();
  } catch (e) { AC = null; }
}
function noiseHit(dur, freq, type, vol, q = 1) {
  if (!AC) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, type, vol) {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const volAt = (x, y) => clamp(1 - dist(x, y, player.x, player.y) / 20, 0, 1);
const sfx = {
  mg() { noiseHit(0.07, 2200, 'bandpass', 0.35, 0.8); tone(180, 60, 0.05, 'square', 0.08); },
  emg(x, y) { const v = volAt(x, y); if (v > 0) noiseHit(0.06, 1500, 'bandpass', 0.2 * v, 0.8); },
  cannon() { noiseHit(0.5, 700, 'lowpass', 0.7); tone(140, 35, 0.35, 'sine', 0.6); },
  ecannon(x, y) { const v = volAt(x, y); if (v > 0) { noiseHit(0.45, 500, 'lowpass', 0.5 * v); tone(110, 30, 0.3, 'sine', 0.35 * v); } },
  boom(x, y, big) { const v = volAt(x, y); if (v > 0) { noiseHit(big ? 1.4 : 0.8, big ? 380 : 600, 'lowpass', (big ? 0.95 : 0.6) * v); tone(90, 25, big ? 0.8 : 0.4, 'sine', 0.5 * v); } },
  ping(x, y) { const v = volAt(x, y); if (v > 0) tone(rnd(1400, 2200), 600, 0.06, 'triangle', 0.08 * v); },
  hurt() { tone(220, 70, 0.18, 'square', 0.18); noiseHit(0.15, 900, 'bandpass', 0.3); },
  crack() { noiseHit(0.25, 1200, 'highpass', 0.25); tone(300, 80, 0.12, 'triangle', 0.1); },
  pick() { tone(520, 520, 0.08, 'square', 0.12); setTimeout(() => tone(780, 780, 0.12, 'square', 0.12), 80); },
  click() { tone(900, 400, 0.04, 'square', 0.08); },
  collapse(x, y) { const v = volAt(x, y); if (v > 0) { noiseHit(1.6, 250, 'lowpass', 0.8 * v); noiseHit(0.9, 2500, 'highpass', 0.12 * v); } },
};
function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; toast(m ? 'TON AUS' : 'TON AN', 0.9); }

// ---------------------------------------------------------------- Spielzustand
const G = {
  state: 'menu', level: 0, score: 0, levelStartScore: 0, ctrl: 'tank', time: 0,
  enemies: [], bullets: [], shells: [], grenades: [], parts: [], pickups: [],
  exit: { x: 0, y: 0 }, start: { x: 0, y: 0 }, exitOpen: false, shake: 0,
  kills: 0, levelTime: 0, mmDirty: true, dyingT: 0, objTotal: 0, flakes: [],
};
let player = null;
let N = 42, tiles = [], ground = null, gctx = null, GOX = 0, GOY = 0;
let camX = 0, camY = 0, rcx = 0, rcy = 0;
let ZONE = ZONES[0];
let best = +(localStorage.getItem('panzerpanzer_best') || 0);
let worldsDone = {};
try { worldsDone = JSON.parse(localStorage.getItem('panzerpanzer_done') || '{}') || {}; } catch (e) { worldsDone = {}; }

function T(i, j) { return (i < 0 || j < 0 || i >= N || j >= N) ? null : tiles[j * N + i]; }
function blocksMove(i, j) { const t = T(i, j); if (!t) return true; if (t.g === 'water' || t.g === 'void') return true; return !!(t.o && t.o.solid); }
function blocksShot(i, j) { const t = T(i, j); if (!t || t.g === 'void') return true; return !!(t.o && t.o.solid); }

// iso projection
function P(x, y, z = 0) { return [(x - y) * HW - rcx + W / 2, (x + y) * HH - z - rcy + H / 2]; }
function toWorld(sx, sy) {
  const X = sx - W / 2 + camX, Y = sy - H / 2 + camY;
  return [(X / HW + Y / HH) / 2, (Y / HH - X / HW) / 2];
}

// ---------------------------------------------------------------- Objekte
const OB = {
  rock(R, col) {
    const pts = [], n = 7, rad = 0.3 + R() * 0.14;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + R() * 0.4, r = rad * (0.72 + R() * 0.35);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return { k: 'rock', solid: true, hp: 260, max: 260, h: 10 + R() * 18, col, pts };
  },
  tree(R, type) { return { k: 'tree', solid: true, hp: 26, max: 26, type, h: 0.85 + R() * 0.4, s: R() }; },
  bld(R, h, col, win) { return { k: 'bld', solid: true, hp: 90 + h * 1.6, max: 90 + h * 1.6, h, col, win, s: R(), roof: R() < 0.4 }; },
  wall(R, col, dir) { return { k: 'wall', solid: true, hp: 90, max: 90, h: 13, col, dir }; },
  wreck(R) { return { k: 'wreck', solid: true, hp: 130, max: 130, h: 11, a: R() * TAU, col: ['#6a4430', '#4a5560', '#7a6a4a'][(R() * 3) | 0] }; },
  rubble(R, col) {
    const bits = [];
    for (let k = 0; k < 6; k++) bits.push([0.2 + R() * 0.6, 0.2 + R() * 0.6, 0.1 + R() * 0.16, 3 + R() * 7]);
    return { k: 'rub', solid: false, col, bits };
  },
};

// ---------------------------------------------------------------- Level-Generator
function genLevel(li) {
  const Z = ZONES[li]; ZONE = Z;
  const R = mulberry32(9001 + li * 7717 + ((Math.random() * 1e6) | 0));
  N = Z.key === 'city' ? 42 : Z.key === 'home' ? 84 : 44;
  tiles = [];
  for (let k = 0; k < N * N; k++) tiles.push({ g: 'g', v: (R() * 4) | 0, o: null });
  const nA = makeNoise(R, 40), nB = makeNoise(R, 40);
  const start = Z.key === 'home' ? { x: N - 3.5, y: N - 3.5 } : { x: 3.5, y: 3.5 };
  const exit = Z.key === 'home' ? { x: 3.5, y: 3.5 } : { x: N - 3.5, y: N - 3.5 };
  G.start = start; G.exit = exit; G.bridge = null;
  const near = (i, j, p, r) => Math.hypot(i + 0.5 - p.x, j + 0.5 - p.y) < r;
  const inner = (i, j) => i > 0 && j > 0 && i < N - 1 && j < N - 1;
  const free = (i, j) => { const t = T(i, j); return t && !t.o && t.g !== 'water' && t.g !== 'void' && inner(i, j) && !near(i, j, start, 5) && !near(i, j, exit, 4); };
  const put = (i, j, o) => { if (free(i, j)) { T(i, j).o = o; return true; } return false; };
  const setG = (i, j, g, guard = true) => { const t = T(i, j); if (t && (!guard || (!near(i, j, start, 5) && !near(i, j, exit, 4)))) t.g = g; };

  if (Z.key === 'desert') {
    const oc = { x: N * 0.5 + R() * 6 - 3, y: N * 0.5 + R() * 6 - 3 };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = Math.hypot(i + 0.5 - oc.x, j + 0.5 - oc.y);
      if (d < 2.4 + nA(i / 3, j / 3) * 1.4) setG(i, j, 'water');
      else if (d < 4.2 + nA(i / 3, j / 3)) setG(i, j, 'grass');
    }
    for (let k = 0; k < 18; k++) { const a = R() * TAU, r = 3.4 + R() * 2.5; put(Math.floor(oc.x + Math.cos(a) * r), Math.floor(oc.y + Math.sin(a) * r), OB.tree(R, 'palm')); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (nA(i / 5 + 30, j / 5) > 0.72 && R() < 0.4) put(i, j, OB.rock(R, Z.rock));
      else if (R() < 0.006) put(i, j, OB.rock(R, Z.rock));
      else if (R() < 0.008) put(i, j, OB.tree(R, 'palm'));
      else if (R() < 0.003) put(i, j, OB.wreck(R));
    }
    for (let v = 0; v < 4; v++) {
      const cx = 8 + R() * (N - 16), cy = 8 + R() * (N - 16);
      for (let b = 0; b < 6; b++) put(Math.floor(cx + R() * 6 - 3), Math.floor(cy + R() * 6 - 3), OB.bld(R, 22 + R() * 16, '#c9a26c', false));
      for (let w = 0; w < 5; w++) put(Math.floor(cx + R() * 8 - 4), Math.floor(cy + R() * 8 - 4), OB.wall(R, '#b59c68', R() < 0.5 ? 0 : 1));
    }
  } else if (Z.key === 'forest') {
    const amp = 3 + R() * 2, ph = R() * 6;
    for (let t = -3; t < N + 3; t += 0.25) {
      const x = t, y = N - t + Math.sin(t * 0.22 + ph) * amp;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const i = Math.floor(x) + di, j = Math.floor(y) + dj;
        if (Math.hypot(i + 0.5 - x, j + 0.5 - y) < 1.55) setG(i, j, 'water', false);
      }
    }
    for (const bt of [0.28, 0.52, 0.76]) {
      const x = N * bt, y = N - x + Math.sin(x * 0.22 + ph) * amp;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = Math.floor(x) + di, j = Math.floor(y) + dj, t = T(i, j);
        if (t && t.g === 'water' && Math.abs((i + 0.5 - x) - (j + 0.5 - y)) < 1.6) t.g = 'bridge';
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = nA(i / 5, j / 5);
      if ((v > 0.5 && R() < 0.62) || R() < 0.035) put(i, j, OB.tree(R, R() < 0.3 ? 'pine' : 'oak'));
      else if (nB(i / 4, j / 4) > 0.75 && R() < 0.35) put(i, j, OB.rock(R, Z.rock));
      if (T(i, j).g === 'g' && nB(i / 6 + 9, j / 6) > 0.6) T(i, j).g = 'dirt';
    }
    for (let c = 0; c < 3; c++) {
      const cx = 8 + R() * (N - 16), cy = 8 + R() * (N - 16);
      for (let b = 0; b < 3; b++) put(Math.floor(cx + R() * 4 - 2), Math.floor(cy + R() * 4 - 2), OB.bld(R, 20 + R() * 8, '#7b5a3c', false));
    }
  } else if (Z.key === 'city') {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (i % 8 < 2 || j % 8 < 2) T(i, j).g = 'road';
    const blocks = Math.ceil(N / 8);
    for (let by = 0; by < blocks; by++) for (let bx = 0; bx < blocks; bx++) {
      const type = R(), baseH = 40 + R() * 65;
      for (let j = by * 8 + 2; j < by * 8 + 8; j++) for (let i = bx * 8 + 2; i < bx * 8 + 8; i++) {
        if (!T(i, j)) continue;
        if (type < 0.62) {
          if (R() < 0.12) put(i, j, OB.rubble(R, '#6d6a63'));
          else put(i, j, OB.bld(R, baseH * (0.55 + R() * 0.6), ['#8e8478', '#7c7f84', '#9a8f7c', '#6f6a66'][(bx + by * 3) % 4], true));
        } else if (type < 0.8) {
          T(i, j).g = 'grass';
          if (R() < 0.3) put(i, j, OB.tree(R, 'oak'));
        } else {
          if (R() < 0.35) put(i, j, OB.rubble(R, '#6d6a63'));
          else if (R() < 0.25) put(i, j, OB.bld(R, 14 + R() * 22, '#6f6a66', true));
        }
      }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (T(i, j).g !== 'road') continue;
      if (R() < 0.022) put(i, j, OB.wreck(R));
      else if (R() < 0.01) put(i, j, OB.wall(R, '#9a978e', R() < 0.5 ? 0 : 1));
    }
  } else if (Z.key === 'bridge') {
    const r0 = Math.floor(N / 2) - 4, r1 = r0 + 8;             // Flussreihen j ∈ [r0, r1)
    const bc = Math.floor(N / 2) + Math.floor(R() * 7) - 3;    // Brückenmitte (Spalte)
    const b0 = bc - 2, b1 = bc + 2;                            // Brücke: 4 Felder breit
    G.bridge = { b0, b1, r0, r1, bc };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const t = T(i, j), onB = i >= b0 && i < b1;
      if (j >= r0 && j < r1) t.g = onB ? 'deck' : 'water';
      else if (!onB && (j === r0 - 1 || j === r1) && nA(i / 3, j) > 0.55) t.g = 'water';
      else if (!onB && (j === r0 - 1 || j === r1 || j === r0 - 2 || j === r1 + 1)) t.g = 'mud';
    }
    // Zufahrtsstraßen: Start -> Brücke -> Extraktion
    const road = (i, j) => { const t = T(i, j); if (t && t.g !== 'water' && t.g !== 'deck') t.g = 'road'; };
    for (let i = 2; i < b1; i++) for (let j = 2; j < 4; j++) road(i, j);
    for (let j = 2; j < N - 2; j++) for (let i = bc - 1; i < bc + 1; i++) road(i, j);
    for (let i = bc - 1; i < N - 2; i++) for (let j = N - 4; j < N - 2; j++) road(i, j);
    const putOff = (i, j, o) => { const t = T(i, j); return t && t.g !== 'road' && t.g !== 'deck' && put(i, j, o); };
    // Brückenkopf-Ortschaften an beiden Ufern
    for (const side of [-1, 1]) {
      const jA = side < 0 ? r0 - 8 : r1 + 3, jB = side < 0 ? r0 - 3 : r1 + 8;
      for (let j = jA; j < jB; j++) for (let i = bc - 8; i < bc + 8; i++)
        if (Math.abs(i - bc + 0.5) > 2.5 && R() < 0.33) putOff(i, j, OB.bld(R, 24 + R() * 30, ['#8a7f6e', '#7d7468', '#968a76'][(R() * 3) | 0], true));
    }
    // Sandsackstellungen am feindlichen Ufer (Lücke für die Straße)
    for (let i = bc - 7; i < bc + 7; i++) if (Math.abs(i - bc + 0.5) > 1.5 && R() < 0.7) putOff(i, r1 + 2, OB.wall(R, '#a39468', 0));
    for (let i = bc - 5; i < bc + 5; i++) if (Math.abs(i - bc + 0.5) > 1.5 && R() < 0.3) putOff(i, r0 - 3, OB.wall(R, '#a39468', 0));
    // Wäldchen, Felsen, Wracks
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (nB(i / 5, j / 5) > 0.6 && R() < 0.55) putOff(i, j, OB.tree(R, 'oak'));
      else if (R() < 0.012) putOff(i, j, OB.rock(R, Z.rock));
      else if (R() < 0.006) putOff(i, j, OB.tree(R, 'oak'));
    }
    for (let k = 0; k < 3; k++) { const j = r1 + 4 + Math.floor(R() * 10); if (T(bc, j)) put(bc - 1 + (k % 2), j, OB.wreck(R)); }
  } else if (Z.key === 'home') {
    const CW = 7;                                     // halbe Korridorbreite (in i-j)
    G.roadblocks = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = i - j, t = T(i, j);
      if (Math.abs(k) > CW) { t.g = 'void'; continue; }
      if (Math.abs(k) <= 1) t.g = 'road';
      else if (nB(i / 4, j / 4) > 0.6) t.g = 'dirt';
      else if (nA(i / 6 + 11, j / 6) > 0.62) t.g = 'grass';
    }
    const putOff = (i, j, o) => { const t = T(i, j); return t && t.g !== 'road' && put(i, j, o); };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = Math.abs(i - j);
      if (k > CW) continue;
      if (k >= CW - 1 && R() < 0.75) putOff(i, j, R() < 0.85 ? OB.tree(R, 'autumn') : OB.rock(R, Z.rock));
      else if (k >= 3 && nA(i / 5, j / 5) > 0.6 && R() < 0.5) putOff(i, j, OB.tree(R, 'autumn'));
      else if (k >= 3 && R() < 0.01) putOff(i, j, OB.rock(R, Z.rock));
      else if (k <= 1 && R() < 0.012) put(i, j, OB.wreck(R));
    }
    // Bauernhöfe am Wegesrand
    for (let f = 0; f < 7; f++) {
      const c = 10 + R() * (N - 22), side = R() < 0.5 ? -1 : 1;
      for (let b = 0; b < 3; b++) {
        const k = side * (3 + Math.floor(R() * 3)), i = Math.floor(c + k / 2 + R() * 2), jj = i - k;
        putOff(i, jj, OB.bld(R, 18 + R() * 12, '#8a6a4a', false));
      }
    }
    // Straßensperren quer über den Korridor, jeweils mit Lücke an der Straße
    for (let sb = 14; sb < N - 10; sb += 13) {
      G.roadblocks.push(sb);
      const gap = Math.floor(R() * 9) - 4;
      for (let k = -CW + 1; k <= CW - 1; k++) {
        if (Math.abs(k) <= 1 || k === gap) continue;
        const i = sb + Math.ceil(k / 2), jj = i - k;
        if (R() < 0.85) putOff(i, jj, OB.wall(R, '#a39468', (k & 1) ? 0 : 1));
      }
    }
    // Heimatdorf am Ziel
    for (let n = 0; n < 40; n++) {
      const i = Math.floor(exit.x + R() * 12 - 3), jj = Math.floor(exit.y + R() * 12 - 3), k = Math.abs(i - jj);
      if (k >= 2 && k <= CW - 1 && Math.hypot(i + 0.5 - exit.x, jj + 0.5 - exit.y) > 4.5) putOff(i, jj, OB.bld(R, 22 + R() * 14, '#b07a4a', true));
    }
  } else { // snow
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (nB(i / 7, j / 7) > 0.7) setG(i, j, 'ice', false);
      const v = nA(i / 5, j / 5);
      if (T(i, j).g !== 'ice') {
        if ((v > 0.52 && R() < 0.6) || R() < 0.03) put(i, j, OB.tree(R, 'pine'));
        else if (R() < 0.02) put(i, j, OB.rock(R, Z.rock));
      }
    }
    for (let l = 0; l < 6; l++) {
      let i = Math.floor(6 + R() * (N - 12)), j = Math.floor(6 + R() * (N - 12));
      const dir = R() < 0.5 ? 0 : 1, len = 4 + Math.floor(R() * 6);
      for (let k = 0; k < len; k++) { if (R() < 0.85) put(i, j, OB.wall(R, '#9b9b94', dir)); if (dir === 0) i++; else j++; }
    }
    for (let c = 0; c < 3; c++) {
      const cx = 8 + R() * (N - 16), cy = 8 + R() * (N - 16);
      for (let b = 0; b < 4; b++) put(Math.floor(cx + R() * 5 - 2), Math.floor(cy + R() * 5 - 2), OB.bld(R, 22 + R() * 12, '#6d5a48', false));
    }
  }
  // Bäume am Kartenrand für Rahmen
  for (let k = 0; k < N; k++) {
    for (const [i, j] of [[k, 0], [0, k], [k, N - 1], [N - 1, k]]) {
      const t = T(i, j);
      if (t && !t.o && t.g !== 'water' && R() < 0.5 && !near(i, j, start, 4) && !near(i, j, exit, 3))
        if (t.g === 'void') continue;
        t.o = Z.key === 'desert' || Z.key === 'city' ? OB.rock(R, Z.rock) : OB.tree(R, Z.key === 'snow' ? 'pine' : Z.key === 'home' ? 'autumn' : 'oak');
    }
  }

  // ---- Gegner
  const findFree = (minD) => {
    for (let tries = 0; tries < 800; tries++) {
      const i = 1 + Math.floor(R() * (N - 2)), j = 1 + Math.floor(R() * (N - 2));
      const t = T(i, j);
      if (t.o || t.g === 'water' || t.g === 'void') continue;
      if (Math.hypot(i + 0.5 - start.x, j + 0.5 - start.y) < minD) continue;
      if (G.enemies.some(e => dist(e.x, e.y, i + 0.5, j + 0.5) < 1.2)) continue;
      return { x: i + 0.5, y: j + 0.5 };
    }
    return { x: N / 2, y: N / 2 };
  };
  const dm = 1 + li * 0.18;
  G.enemies = [];
  const findNear = (cx, cy, rad) => {
    for (let tries = 0; tries < 400; tries++) {
      const i = Math.floor(cx + (R() * 2 - 1) * rad), j = Math.floor(cy + (R() * 2 - 1) * rad), t = T(i, j);
      if (!t || t.o || t.g === 'water' || t.g === 'void' || t.g === 'deck' || t.g === 'road') continue;
      if (G.enemies.some(e => dist(e.x, e.y, i + 0.5, j + 0.5) < 1.5)) continue;
      return { x: i + 0.5, y: j + 0.5 };
    }
    return findFree(15);
  };  const along = f => ({ x: start.x + (exit.x - start.x) * f, y: start.y + (exit.y - start.y) * f });
  for (let k = 0; k < Z.tanks; k++) {
    if (Z.key === 'home') { const c = along(0.18 + 0.78 * (k + 0.5) / Z.tanks); const p = findNear(c.x, c.y, 4); G.enemies.push(mkTank(p.x, p.y, dm)); }
    else { const p = findFree(13); G.enemies.push(mkTank(p.x, p.y, dm)); }
  }

  for (let k = 0; k < Z.bunkers; k++) {
    let p;
    if (G.bridge) p = findNear(G.bridge.bc, G.bridge.r1 + 3.5 + (k > 1 ? 3 : 0), 4.5);
    else if (Z.key === 'home' && G.roadblocks.length) { const sb = G.roadblocks[k % G.roadblocks.length] - 2; p = findNear(sb, sb, 3.5); }
    else p = findFree(15);
    G.enemies.push(mkBunker(p.x, p.y, dm, G.bridge ? (k % 2 ? 'mg' : 'cannon') : (R() < 0.5 ? 'mg' : 'cannon')));
  }
  let left = Z.inf;
  while (left > 0) {
    const p = findFree(11), n = Math.min(left, 2 + Math.floor(R() * 3));
    for (let k = 0; k < n; k++) {
      let x = p.x + rnd(-1, 1), y = p.y + rnd(-1, 1);
      if (blocksMove(Math.floor(x), Math.floor(y))) { x = p.x; y = p.y; }
      G.enemies.push(mkInf(x, y, dm));
    }
    left -= n;
  }
  G.pickups = [];
  for (let k = 0; k < (Z.key === 'home' ? 10 : 5); k++) { const p = findFree(8); G.pickups.push({ x: p.x, y: p.y, kind: k % 2 ? 'repair' : 'ammo', t: R() * 6 }); }

  renderGround();
  G.mmDirty = true;
}

function mkTank(x, y, dm) {
  const a = rnd(0, TAU);
  return { type: 'tank', x, y, a, ta: a, r: 0.46, hp: 110 * dm, max: 110 * dm, speed: 1.35 + dm * 0.2, cd: rnd(1, 3), dm,
    alert: false, home: { x, y }, wp: null, wpT: 0, avoidT: 0, avoidA: 0, flash: 0, dead: false, body: true, armored: true,
    crush: true, losT: 0, los: false, orbit: Math.random() < 0.5 ? 1 : -1, smokeT: 0, trackD: 0, moving: false };
}
function mkInf(x, y, dm) {
  return { type: 'inf', x, y, a: rnd(0, TAU), ta: 0, r: 0.17, hp: 18, max: 18, speed: 1.25, cd: rnd(1, 2.5), dm,
    alert: false, home: { x, y }, wp: null, wpT: 0, avoidT: 0, avoidA: 0, flash: 0, dead: false, body: true, armored: false,
    losT: 0, los: false, orbit: Math.random() < 0.5 ? 1 : -1, walk: 0, moving: false };
}
function mkBunker(x, y, dm, kind) {
  return { type: 'bunker', kind, x, y, a: 0, ta: rnd(0, TAU), r: 0.5, hp: 170 * dm, max: 170 * dm, cd: rnd(1, 2), dm,
    burst: 0, bt: 0, alert: false, flash: 0, dead: false, body: true, armored: true, losT: 0, los: false, smokeT: 0 };
}

// ---------------------------------------------------------------- Boden vorrendern
function groundColor(t) {
  switch (t.g) {
    case 'water': return ZONE.water;
    case 'road': return ['#4d4d4f', '#4a4a4c', '#505052', '#474749'][t.v];
    case 'bridge': return '#7d5d3b';
    case 'void': return ZONE.voidCol || '#222';
    case 'deck': return ['#9b978d', '#96928a', '#a09c92', '#93908a'][t.v];
    case 'mud': return ['#6d6440', '#675e3b', '#736a45', '#625a37'][t.v];
    case 'ice': return ['#bcd4e4', '#b6cfe0', '#c2d9e8', '#b0cadb'][t.v];
    case 'grass': return ZONE.key === 'desert' ? ['#8f9c4c', '#97a352', '#889545', '#9aa656'][t.v] : ['#6b7d45', '#66783f', '#71834a', '#62743c'][t.v];
    case 'dirt': return ['#6e6a3a', '#696536', '#74703f', '#646032'][t.v];
    default: return ZONE.ground[t.v];
  }
}
function renderGround() {
  const kR = ZONE.key === 'home' ? 24 : N;          // sichtbarer Bereich in (i-j)
  GOX = (kR + 1) * HW; GOY = TH * 2;
  ground = document.createElement('canvas');
  ground.width = (2 * kR + 2) * HW; ground.height = N * TH + TH * 4;
  gctx = ground.getContext('2d');
  // Clip auf Kartenraute
  gctx.beginPath();
  gctx.moveTo(GOX, GOY); gctx.lineTo(GOX + N * HW, GOY + N * HH); gctx.lineTo(GOX, GOY + N * TH); gctx.lineTo(GOX - N * HW, GOY + N * HH);
  gctx.closePath(); gctx.clip();
  const R = mulberry32(42 + G.level);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (Math.abs(i - j) > kR) continue;
    const t = T(i, j), col = groundColor(t);
    if (t.g === 'void') {   // undurchdringlicher Wald / Hügel
      const x0 = (i - j) * HW + GOX, y0 = (i + j) * HH + GOY;
      gctx.fillStyle = col; gctx.strokeStyle = col; gctx.lineWidth = 1.2;
      gctx.beginPath(); gctx.moveTo(x0, y0); gctx.lineTo(x0 + HW, y0 + HH); gctx.lineTo(x0, y0 + TH); gctx.lineTo(x0 - HW, y0 + HH); gctx.closePath(); gctx.fill(); gctx.stroke();
      for (let k = 0; k < 3; k++) {
        const u = R(), v = R(), px = (i + u - (j + v)) * HW + GOX, py = (i + u + j + v) * HH + GOY;
        gctx.fillStyle = ['#3a2c14', '#4a3216', '#24260f', '#5a3a14'][(R() * 4) | 0];
        gctx.beginPath(); gctx.arc(px, py - 4, 9 + R() * 8, 0, TAU); gctx.fill();
      }
      continue;
    }
    const x0 = (i - j) * HW + GOX, y0 = (i + j) * HH + GOY;
    gctx.fillStyle = col; gctx.strokeStyle = col; gctx.lineWidth = 1.2;
    gctx.beginPath(); gctx.moveTo(x0, y0); gctx.lineTo(x0 + HW, y0 + HH); gctx.lineTo(x0, y0 + TH); gctx.lineTo(x0 - HW, y0 + HH); gctx.closePath();
    gctx.fill(); gctx.stroke();
    const spk = t.g === 'water' ? 0 : 9;
    for (let k = 0; k < spk; k++) {
      const u = R(), v = R();
      const px = (i + u - (j + v)) * HW + GOX, py = (i + u + j + v) * HH + GOY;
      gctx.fillStyle = shade(col, R() < 0.5 ? -0.08 : 0.07);
      gctx.fillRect(px, py, 2 + R() * 3, 1 + R());
    }
    if (t.g === 'water') {
      gctx.strokeStyle = shade(col, 0.25); gctx.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        const u = R() * 0.6 + 0.2, v = R() * 0.6 + 0.2;
        const px = (i + u - (j + v)) * HW + GOX, py = (i + u + j + v) * HH + GOY;
        gctx.beginPath(); gctx.moveTo(px - 8, py); gctx.quadraticCurveTo(px - 2, py - 3, px + 4, py); gctx.stroke();
      }
    } else if (t.g === 'bridge') {
      gctx.strokeStyle = shade(col, -0.3); gctx.lineWidth = 1;
      for (let k = 1; k < 5; k++) {
        const a = k / 5;
        const p1 = [(i + a - j) * HW + GOX, (i + a + j) * HH + GOY], p2 = [(i + a - j - 1) * HW + GOX, (i + a + j + 1) * HH + GOY];
        gctx.beginPath(); gctx.moveTo(p1[0], p1[1]); gctx.lineTo(p2[0], p2[1]); gctx.stroke();
      }
    } else if (t.g === 'road' && ZONE.key === 'city' && (i % 8 === 1 || j % 8 === 1) && !(i % 8 < 2 && j % 8 < 2)) {
      // Mittellinie
      gctx.strokeStyle = 'rgba(230,220,160,0.55)'; gctx.lineWidth = 2;
      gctx.beginPath();
      if (i % 8 === 1) { gctx.moveTo((i + 1 - j - 0.3) * HW + GOX, (i + 1 + j + 0.3) * HH + GOY); gctx.lineTo((i + 1 - j - 0.7) * HW + GOX, (i + 1 + j + 0.7) * HH + GOY); }
      else { gctx.moveTo((i + 0.3 - j - 1) * HW + GOX, (i + 0.3 + j + 1) * HH + GOY); gctx.lineTo((i + 0.7 - j - 1) * HW + GOX, (i + 0.7 + j + 1) * HH + GOY); }
      gctx.stroke();
    }
    // Uferkante
    if (t.g !== 'water') {
      const w1 = T(i, j - 1), w2 = T(i - 1, j);
      gctx.strokeStyle = 'rgba(255,255,255,0.25)'; gctx.lineWidth = 2;
      if (w1 && w1.g === 'water') { gctx.beginPath(); gctx.moveTo(x0, y0); gctx.lineTo(x0 + HW, y0 + HH); gctx.stroke(); }
      if (w2 && w2.g === 'water') { gctx.beginPath(); gctx.moveTo(x0, y0); gctx.lineTo(x0 - HW, y0 + HH); gctx.stroke(); }
    }
  }
  drawBridgeDetails();
}
function drawBridgeDetails() {
  const B = G.bridge; if (!B) return;
  const g = gctx, I = (x, y, z = 0) => [(x - y) * HW + GOX, (x + y) * HH + GOY - z];
  const line = (a, b, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };
  // Schatten der Brücke auf dem Wasser
  g.fillStyle = 'rgba(0,10,20,0.35)';
  g.beginPath(); const s0 = I(B.b1, B.r0), s1 = I(B.b1 + 0.45, B.r0 + 0.2), s2 = I(B.b1 + 0.45, B.r1), s3 = I(B.b1, B.r1);
  g.moveTo(...s0); g.lineTo(...s1); g.lineTo(...s2); g.lineTo(...s3); g.closePath(); g.fill();
  // Brückenpfeiler
  for (let j = B.r0 + 1.5; j < B.r1; j += 2.5) for (const x of [B.b0 - 0.25, B.b1 + 0.05]) {
    const p = I(x + 0.1, j); g.fillStyle = 'rgba(40,45,48,0.9)'; g.beginPath(); g.ellipse(p[0], p[1], 9, 4.5, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(p[0], p[1] + 2, 13, 6, 0, 0, Math.PI); g.stroke();
  }
  // Fahrbahnmarkierung
  g.setLineDash([10, 10]); line(I(B.bc, B.r0 - 0.5), I(B.bc, B.r1 + 0.5), 'rgba(240,230,170,0.7)', 2); g.setLineDash([]);
  // Gehwege / Bordstein
  for (const x of [B.b0 + 0.35, B.b1 - 0.35]) line(I(x, B.r0), I(x, B.r1), 'rgba(60,58,54,0.5)', 1.5);
  // Geländer mit Pfosten
  for (const x of [B.b0 + 0.06, B.b1 - 0.06]) {
    line(I(x, B.r0 - 0.3), I(x, B.r1 + 0.3), 'rgba(0,0,0,0.25)', 3);
    for (let j = B.r0 - 0.3; j <= B.r1 + 0.3; j += 0.5) { const a = I(x, j), b = I(x, j, 9); line(a, b, '#4a4844', 2.2); }
    line(I(x, B.r0 - 0.3, 9), I(x, B.r1 + 0.3, 9), '#5d5a55', 3);
    line(I(x, B.r0 - 0.3, 10), I(x, B.r1 + 0.3, 10), '#8d8a83', 1.2);
  }
  // Brückenköpfe (Widerlager)
  for (const j of [B.r0, B.r1]) line(I(B.b0, j), I(B.b1, j), 'rgba(50,48,45,0.6)', 3);
}
function decal(x, y, fn) { if (!gctx) return; fn(gctx, (x - y) * HW + GOX, (x + y) * HH + GOY); }
function crater(x, y, r) {
  { const t = T(Math.floor(x), Math.floor(y)); if (t && t.g === 'void') return; }
  decal(x, y, (g, px, py) => {
    const rx = r * HW * 1.1;
    const gr = g.createRadialGradient(px, py, 0, px, py, rx);
    gr.addColorStop(0, 'rgba(25,18,10,0.65)'); gr.addColorStop(0.55, 'rgba(45,32,20,0.35)'); gr.addColorStop(1, 'rgba(45,32,20,0)');
    g.save(); g.translate(px, py); g.scale(1, 0.5); g.translate(-px, -py);
    g.fillStyle = gr; g.beginPath(); g.arc(px, py, rx, 0, TAU); g.fill(); g.restore();
  });
}
function trackMark(x, y) {
  decal(x, y, (g, px, py) => {
    g.fillStyle = ZONE.key === 'snow' ? 'rgba(90,100,115,0.16)' : 'rgba(30,22,12,0.11)';
    g.beginPath(); g.ellipse(px, py, 4, 2, 0, 0, TAU); g.fill();
  });
}

// ---------------------------------------------------------------- Level laden
function newPlayer() {
  return { type: 'player', x: 0, y: 0, a: Math.PI / 4, ta: Math.PI / 4, r: 0.46, speed: 0, hp: 100, maxHp: 100,
    shells: 30, maxShells: 40, heat: 0, over: false, mgCd: 0, gCd: 0, flash: 0, trackD: 0, body: true, crush: true, dead: false };
}
function loadLevel(li, fresh) {
  G.level = li;
  G.bullets = []; G.shells = []; G.grenades = []; G.parts = [];
  G.exitOpen = false; G.roadblocks = []; G.shake = 0; G.kills = 0; G.levelTime = 0;
  if (!player || fresh) player = newPlayer();
  genLevel(li);
  const a0 = Math.atan2(G.exit.y - G.start.y, G.exit.x - G.start.x);
  player.x = G.start.x; player.y = G.start.y; player.a = a0; player.ta = a0; player.speed = 0;
  G.exitOpen = !!ZONE.exitAlways;
  player.dead = false; player.body = true; player.flash = 0; player.heat = 0; player.over = false; player.gCd = 0.4;
  G.objTotal = G.enemies.filter(e => e.type !== 'inf').length;
  G.levelStartScore = G.score;
  camX = (player.x - player.y) * HW; camY = (player.x + player.y) * HH;
  G.flakes = [];
  if (ZONE.key === 'snow') for (let k = 0; k < 160; k++) G.flakes.push({ x: Math.random() * W, y: Math.random() * H, s: rnd(0.6, 2.2), v: rnd(20, 60) });
}

// ---------------------------------------------------------------- Partikel
function addP(o) { if (G.parts.length < 1800) G.parts.push(o); }
function smoke(x, y, z, opts = {}) {
  const life = opts.life || rnd(1, 2);
  addP({ t: 's', x, y, z, vx: (opts.vx || 0) + rnd(-0.25, 0.25), vy: (opts.vy || 0) + rnd(-0.25, 0.25), vz: opts.vz ?? rnd(12, 35),
    life, max: life, size: opts.size || rnd(5, 9), grow: opts.grow ?? 10,
    c: opts.c || [60, 60, 60], a0: opts.a ?? 0.5 });
}
function explosionFX(x, y, sc) {
  addP({ t: 'l', x, y, z: 10, life: 0.14, max: 0.14, size: 70 * sc });
  addP({ t: 'r', x, y, z: 0, life: 0.45, max: 0.45, size: 6, grow: 260 * sc });
  for (let k = 0; k < 16 * sc; k++) addP({ t: 'f', x, y, z: rnd(2, 14), vx: rnd(-1.6, 1.6) * sc, vy: rnd(-1.6, 1.6) * sc, vz: rnd(20, 130), life: rnd(0.25, 0.7), max: 0.7, size: rnd(6, 15) * sc, grow: 8 });
  for (let k = 0; k < 12 * sc; k++) smoke(x + rnd(-0.3, 0.3), y + rnd(-0.3, 0.3), rnd(5, 20), { life: rnd(1.4, 2.8), size: rnd(8, 15) * sc, grow: 16, vz: rnd(15, 40), c: [45, 42, 40], a: 0.6 });
  for (let k = 0; k < 10 * sc; k++) addP({ t: 'd', x, y, z: 8, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(90, 260), life: rnd(1, 1.8), max: 1.8, size: rnd(2, 4.5), c: ZONE.key === 'snow' ? '#e8eef2' : '#3a3026', rot: rnd(0, TAU) });
  for (let k = 0; k < 12 * sc; k++) addP({ t: 'k', x, y, z: 10, vx: rnd(-6, 6), vy: rnd(-6, 6), vz: rnd(50, 220), life: rnd(0.2, 0.5), max: 0.5 });
  if (ZONE.key === 'snow' || ZONE.key === 'desert')
    for (let k = 0; k < 8; k++) smoke(x + rnd(-0.6, 0.6), y + rnd(-0.6, 0.6), 2, { life: rnd(0.8, 1.5), size: 10, grow: 20, vz: 8, c: ZONE.key === 'snow' ? [235, 240, 245] : [200, 170, 120], a: 0.5 });
}
function muzzle(x, y, z, a, big) {
  addP({ t: 'l', x, y, z, life: big ? 0.09 : 0.04, max: big ? 0.09 : 0.04, size: big ? 34 : 14 });
  for (let k = 0; k < (big ? 6 : 2); k++) addP({ t: 'f', x, y, z, vx: Math.cos(a) * rnd(1, 4), vy: Math.sin(a) * rnd(1, 4), vz: rnd(-10, 20), life: rnd(0.06, 0.16), max: 0.16, size: big ? rnd(5, 9) : rnd(2, 4), grow: 2 });
  if (big) for (let k = 0; k < 5; k++) smoke(x, y, z, { vx: Math.cos(a) * rnd(0.3, 1.2), vy: Math.sin(a) * rnd(0.3, 1.2), life: rnd(0.7, 1.3), size: 6, grow: 12, c: [150, 150, 145], a: 0.45 });
}
function sparks(x, y, z, n = 4) { for (let k = 0; k < n; k++) addP({ t: 'k', x, y, z, vx: rnd(-3, 3), vy: rnd(-3, 3), vz: rnd(30, 120), life: rnd(0.1, 0.3), max: 0.3 }); }
function floatText(x, y, text, col = '#e8b93a') { addP({ t: 'x', x, y, z: 30, vz: 26, life: 1.2, max: 1.2, text, col }); }

function updateParts(dt) {
  const ps = G.parts;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    if (p.vx) p.x += p.vx * dt;
    if (p.vy) p.y += p.vy * dt;
    if (p.t === 'd' || p.t === 'k') {
      p.vz -= 520 * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
      if (p.t === 'd') p.rot += dt * 8;
    } else if (p.vz) {
      p.z += p.vz * dt;
      if (p.t === 's' || p.t === 'f') { p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5; }
    }
  }
}

// ---------------------------------------------------------------- Kollision
function actorsAll() { return G.enemies; }
function hits(x, y, self) {
  const r = self.r;
  for (let j = Math.floor(y - r); j <= Math.floor(y + r); j++)
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) {
      if (!blocksMove(i, j)) continue;
      const cx = clamp(x, i, i + 1), cy = clamp(y, j, j + 1);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) {
        const t = T(i, j);
        if (self.crush && t && t.o && t.o.k === 'tree') { destroyTile(i, j, 'crush'); return { crush: true }; }
        return { tile: true };
      }
    }
  const test = o => {
    if (o === self || !o.body || o.dead) return false;
    if (o.type === 'inf' && self.type !== 'inf') return false;
    const rr = r + o.r, nd = (x - o.x) ** 2 + (y - o.y) ** 2;
    if (nd < rr * rr && nd < (self.x - o.x) ** 2 + (self.y - o.y) ** 2) return true;
    return false;
  };
  if (self !== player && test(player)) return { actor: player };
  for (const o of G.enemies) if (test(o)) return { actor: o };
  return null;
}
function moveActor(e, dx, dy) {
  let blocked = false;
  if (dx) { const h = hits(e.x + dx, e.y, e); if (!h) e.x += dx; else if (h.crush) e.x += dx * 0.4; else blocked = true; }
  if (dy) { const h = hits(e.x, e.y + dy, e); if (!h) e.y += dy; else if (h.crush) e.y += dy * 0.4; else blocked = true; }
  return blocked;
}
function hasLOS(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.3);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (blocksShot(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Zerstörung
function damageTile(i, j, dmg, mg) {
  const t = T(i, j);
  if (!t || !t.o || !t.o.solid) return;
  const o = t.o;
  if (mg) dmg *= o.k === 'tree' ? 1 : o.k === 'rock' ? 0 : 0.15;
  o.hp -= dmg;
  if (o.hp <= 0) destroyTile(i, j, mg ? 'mg' : 'boom');
}
function destroyTile(i, j, how) {
  const t = T(i, j), o = t.o;
  if (!o) return;
  const cx = i + 0.5, cy = j + 0.5;
  if (o.k === 'tree') {
    t.o = { k: 'stump', solid: false, a: how === 'crush' ? player.a : rnd(0, TAU), type: o.type };
    const leaf = o.type === 'palm' ? '#6f9a3a' : o.type === 'pine' ? '#2f5a3a' : o.type === 'autumn' ? '#c46a26' : '#4f7a2e';
    for (let k = 0; k < 10; k++) addP({ t: 'd', x: cx, y: cy, z: rnd(10, 30), vx: rnd(-1.5, 1.5), vy: rnd(-1.5, 1.5), vz: rnd(30, 110), life: rnd(0.8, 1.4), max: 1.4, size: rnd(2, 4), c: leaf, rot: 0 });
    if (ZONE.key === 'snow') for (let k = 0; k < 5; k++) smoke(cx, cy, 25, { c: [240, 244, 248], life: 1, size: 8, grow: 14, vz: -5, a: 0.6 });
    sfx.crack();
  } else if (o.k === 'bld') {
    t.o = OB.rubble(Math.random, shade(o.col, -0.25).replace(/rgb\((\d+),(\d+),(\d+)\)/, (m, r, g, b) => '#' + [r, g, b].map(v => (+v).toString(16).padStart(2, '0')).join('')));
    for (let k = 0; k < 18; k++) smoke(cx + rnd(-0.4, 0.4), cy + rnd(-0.4, 0.4), rnd(0, o.h), { c: [120, 112, 100], life: rnd(1.5, 3), size: rnd(10, 18), grow: 18, vz: rnd(5, 25), a: 0.6 });
    for (let k = 0; k < 14; k++) addP({ t: 'd', x: cx, y: cy, z: rnd(5, o.h), vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(20, 140), life: rnd(1, 2), max: 2, size: rnd(3, 6), c: o.col, rot: 0 });
    G.shake = Math.max(G.shake, 6 * volAt(cx, cy));
    sfx.collapse(cx, cy);
    G.score += 25; floatText(cx, cy, '+25', '#cfc6b0');
  } else if (o.k === 'rock') {
    t.o = OB.rubble(Math.random, o.col);
    for (let k = 0; k < 10; k++) addP({ t: 'd', x: cx, y: cy, z: 10, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(40, 160), life: 1.4, max: 1.4, size: rnd(2, 5), c: o.col, rot: 0 });
  } else if (o.k === 'wall' || o.k === 'wreck') {
    t.o = OB.rubble(Math.random, o.k === 'wreck' ? '#3a2e26' : o.col);
    for (let k = 0; k < 8; k++) smoke(cx, cy, 6, { c: [90, 85, 75], life: 1.4, size: 10, grow: 12 });
  }
  G.mmDirty = true;
}
function hurtEnemy(e, dmg, kind) {
  if (e.dead) return;
  if (kind === 'mg' && e.armored) { dmg *= 0.18; sparks(e.x, e.y, 14, 2); if (Math.random() < 0.3) sfx.ping(e.x, e.y); }
  e.hp -= dmg; e.flash = 0.08;
  alertNear(e.x, e.y, 6); e.alert = true;
  if (e.hp <= 0) killEnemy(e);
}
function alertNear(x, y, r) { for (const o of G.enemies) if (!o.dead && dist(o.x, o.y, x, y) < r) o.alert = true; }
function killEnemy(e) {
  if (e.dead) return;
  e.dead = true; e.body = false; G.kills++;
  if (e.type === 'tank' || e.type === 'bunker') {
    explosionFX(e.x, e.y, 1.4); crater(e.x, e.y, 1.3);
    sfx.boom(e.x, e.y, true);
    G.shake = Math.max(G.shake, 12 * volAt(e.x, e.y));
    e.smokeT = 14;
    const pts = e.type === 'tank' ? 300 : 400;
    G.score += pts; floatText(e.x, e.y, '+' + pts);
    if (e.type === 'bunker' || Math.random() < 0.6) {
      const kind = e.type === 'bunker' ? 'ammo' : (player.hp / player.maxHp < player.shells / player.maxShells ? 'repair' : 'ammo');
      G.pickups.push({ x: e.x + rnd(-0.3, 0.3), y: e.y + rnd(-0.3, 0.3), kind, t: 0 });
    }
    checkObjectives();
  } else {
    for (let k = 0; k < 6; k++) smoke(e.x, e.y, 4, { c: ZONE.key === 'snow' ? [230, 235, 240] : [150, 130, 100], life: 0.8, size: 5, grow: 10, vz: 10, a: 0.5 });
    decal(e.x, e.y, (g, px, py) => { g.fillStyle = 'rgba(40,25,20,0.4)'; g.beginPath(); g.ellipse(px, py, 7, 3.5, 0, 0, TAU); g.fill(); });
    G.score += 50; floatText(e.x, e.y, '+50', '#e9e4d2');
    if (Math.random() < 0.12) G.pickups.push({ x: e.x, y: e.y, kind: Math.random() < 0.5 ? 'ammo' : 'repair', t: 0 });
  }
}
function objectivesLeft() { return G.enemies.reduce((n, e) => n + (!e.dead && e.type !== 'inf' ? 1 : 0), 0); }
function checkObjectives() {
  if (ZONE.exitAlways) { if (objectivesLeft() === 0) toast('ALLE PANZER UND BUNKER VERNICHTET – DER WEG IST FREI!', 3); return; }
  if (!G.exitOpen && objectivesLeft() === 0) {
    G.exitOpen = true;
    toast('ALLE ZIELE VERNICHTET – AB ZUM EXTRAKTIONSPUNKT!', 3.5);
  } else if (!G.exitOpen) {
    const n = objectivesLeft();
    if (n <= 2) toast(n === 1 ? 'NOCH 1 ZIEL' : 'NOCH 2 ZIELE', 1.8);
  }
}
function hurtPlayer(dmg) {
  if (player.dead) return;
  player.hp -= dmg; player.flash = 0.25;
  G.shake = Math.max(G.shake, Math.min(10, 2 + dmg * 0.4));
  sfx.hurt();
  if (player.hp <= 0) {
    player.hp = 0; player.dead = true; player.body = false;
    explosionFX(player.x, player.y, 2); crater(player.x, player.y, 1.6); sfx.boom(player.x, player.y, true);
    G.shake = 20; G.state = 'dying'; G.dyingT = 2.2;
  }
}
function explode(x, y, r, dmg, from, sc = 1) {
  if (from === 'p') {
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < r + e.r) hurtEnemy(e, dmg * (1 - Math.min(1, d / (r + e.r)) * 0.65), 'boom');
    }
    alertNear(x, y, 7);
  } else if (!player.dead) {
    const d = dist(x, y, player.x, player.y);
    if (d < r + player.r) hurtPlayer(dmg * (1 - Math.min(1, d / (r + player.r)) * 0.6));
  }
  for (let j = Math.floor(y - r - 1); j <= Math.floor(y + r); j++)
    for (let i = Math.floor(x - r - 1); i <= Math.floor(x + r); i++) {
      const t = T(i, j);
      if (!t || !t.o || !t.o.solid) continue;
      const d = dist(x, y, i + 0.5, j + 0.5);
      if (d < r + 0.45) damageTile(i, j, (from === 'p' ? dmg : dmg * 0.5) * (1 - d / (r + 1.2)));
    }
  const t = T(Math.floor(x), Math.floor(y));
  if (t && t.g === 'water') {
    for (let k = 0; k < 20; k++) addP({ t: 'd', x, y, z: 2, vx: rnd(-1.2, 1.2), vy: rnd(-1.2, 1.2), vz: rnd(100, 260), life: 1.2, max: 1.2, size: rnd(2, 4), c: '#cfe6f2', rot: 0 });
    addP({ t: 'r', x, y, z: 0, life: 0.6, max: 0.6, size: 4, grow: 140 });
    sfx.boom(x, y, false);
  } else {
    explosionFX(x, y, sc); crater(x, y, r * 0.8); sfx.boom(x, y, sc > 1);
  }
  G.shake = Math.max(G.shake, 7 * sc * volAt(x, y));
}

// ---------------------------------------------------------------- Waffen
function fireMG() {
  const p = player, a = p.ta + rnd(-0.035, 0.035);
  const ox = p.x + Math.cos(p.ta) * 0.62 - Math.sin(p.ta) * 0.1, oy = p.y + Math.sin(p.ta) * 0.62 + Math.cos(p.ta) * 0.1;
  G.bullets.push({ x: ox, y: oy, z: 18, vx: Math.cos(a) * 19, vy: Math.sin(a) * 19, life: 0.6, dmg: 7, from: 'p' });
  muzzle(ox, oy, 18, a, false);
  sfx.mg();
}
function fireGrenade() {
  const p = player;
  let [ax, ay] = G.aim;
  let dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy);
  const maxR = 10, minR = 1.4;
  if (d > maxR) { ax = p.x + dx / d * maxR; ay = p.y + dy / d * maxR; d = maxR; }
  if (d < minR) { const a = d > 0.01 ? Math.atan2(dy, dx) : p.ta; ax = p.x + Math.cos(a) * minR; ay = p.y + Math.sin(a) * minR; d = minR; }
  const bx = p.x + Math.cos(p.ta) * 0.75, by = p.y + Math.sin(p.ta) * 0.75;
  G.grenades.push({ sx: bx, sy: by, tx: ax, ty: ay, x: bx, y: by, z: 19, t: 0, dur: 0.18 + d / 14, arc: 22 + d * 7 });
  muzzle(bx, by, 19, p.ta, true);
  p.speed -= 0.6;
  G.shake = Math.max(G.shake, 4);
  sfx.cannon();
}
function enemyShell(e) {
  const a = e.ta + rnd(-0.05, 0.05);
  const ox = e.x + Math.cos(e.ta) * 0.7, oy = e.y + Math.sin(e.ta) * 0.7;
  G.shells.push({ x: ox, y: oy, z: 18, vx: Math.cos(a) * 8.5, vy: Math.sin(a) * 8.5, life: 1.5, dmg: 13 * e.dm });
  muzzle(ox, oy, 18, a, true);
  sfx.ecannon(e.x, e.y);
}
function enemyBullet(e, spread, dmg, z) {
  const a = e.ta + rnd(-spread, spread);
  const ox = e.x + Math.cos(e.ta) * (e.r + 0.15), oy = e.y + Math.sin(e.ta) * (e.r + 0.15);
  G.bullets.push({ x: ox, y: oy, z, vx: Math.cos(a) * 13, vy: Math.sin(a) * 13, life: 0.75, dmg, from: 'e' });
  muzzle(ox, oy, z, a, false);
  sfx.emg(e.x, e.y);
}

function updateProjectiles(dt) {
  // Kugeln
  const bs = G.bullets;
  for (let i = bs.length - 1; i >= 0; i--) {
    const b = bs[i];
    b.life -= dt;
    let dead = b.life <= 0;
    const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 0.12);
    for (let s = 0; s < steps && !dead; s++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      const ti = Math.floor(b.x), tj = Math.floor(b.y);
      if (!T(ti, tj)) { dead = true; break; }
      if (blocksShot(ti, tj)) {
        damageTile(ti, tj, b.dmg, true); sparks(b.x, b.y, b.z, 3); dead = true; break;
      }
      if (b.from === 'p') {
        for (const e of G.enemies) {
          if (e.dead) continue;
          if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < (e.r + 0.05) ** 2) { hurtEnemy(e, b.dmg, 'mg'); dead = true; if (!e.armored) sparks(b.x, b.y, 12, 2); break; }
        }
      } else if (!player.dead && (b.x - player.x) ** 2 + (b.y - player.y) ** 2 < player.r ** 2) {
        hurtPlayer(b.dmg); sparks(b.x, b.y, b.z, 3); sfx.ping(b.x, b.y); dead = true;
      }
    }
    if (dead) { bs[i] = bs[bs.length - 1]; bs.pop(); }
  }
  // Feindliche Granaten (Direktschuss)
  const ss = G.shells;
  for (let i = ss.length - 1; i >= 0; i--) {
    const s = ss[i];
    s.life -= dt;
    let boom = s.life <= 0;
    const steps = Math.ceil(Math.hypot(s.vx, s.vy) * dt / 0.12);
    for (let k = 0; k < steps && !boom; k++) {
      s.x += s.vx * dt / steps; s.y += s.vy * dt / steps;
      if (blocksShot(Math.floor(s.x), Math.floor(s.y))) boom = true;
      else if (!player.dead && dist(s.x, s.y, player.x, player.y) < player.r + 0.05) boom = true;
    }
    if (Math.random() < 0.6) smoke(s.x, s.y, s.z, { life: 0.5, size: 3, grow: 6, vz: 4, c: [200, 200, 190], a: 0.35 });
    if (boom) { explode(s.x, s.y, 0.95, s.dmg, 'e', 0.7); ss[i] = ss[ss.length - 1]; ss.pop(); }
  }
  // Spieler-Granaten (Bogenflug)
  const gs = G.grenades;
  for (let i = gs.length - 1; i >= 0; i--) {
    const g = gs[i];
    g.t += dt / g.dur;
    const t = Math.min(1, g.t);
    g.x = lerp(g.sx, g.tx, t); g.y = lerp(g.sy, g.ty, t);
    g.z = 19 * (1 - t) + Math.sin(Math.PI * t) * g.arc;
    if (Math.random() < 0.8) smoke(g.x, g.y, g.z, { life: 0.45, size: 3, grow: 7, vz: 3, c: [210, 205, 195], a: 0.35 });
    if (g.t >= 1) { explode(g.tx, g.ty, 1.7, 72, 'p', 1.15); gs[i] = gs[gs.length - 1]; gs.pop(); }
  }
}

// ---------------------------------------------------------------- Spieler
function updatePlayer(dt) {
  const p = player;
  if (p.dead) return;
  const k = c => keys.has(c);
  const up = k('KeyW') || k('ArrowUp'), dn = k('KeyS') || k('ArrowDown'), lf = k('KeyA') || k('ArrowLeft'), rt = k('KeyD') || k('ArrowRight');
  let fwd = 0;
  if (G.ctrl === 'tank') {
    if (up) fwd += 1; if (dn) fwd -= 1;
    const turn = (rt ? 1 : 0) - (lf ? 1 : 0);
    p.a += turn * 2.2 * dt;
  } else {
    let dx = 0, dy = 0;
    if (up) { dx -= 1; dy -= 1; } if (dn) { dx += 1; dy += 1; }
    if (lf) { dx -= 1; dy += 1; } if (rt) { dx += 1; dy -= 1; }
    if (dx || dy) {
      const want = Math.atan2(dy, dx), d = angDiff(p.a, want);
      if (Math.abs(d) > 2.3) { const w2 = want + Math.PI; p.a = rotTo(p.a, w2, 2.8 * dt); fwd = -Math.max(0, Math.cos(angDiff(p.a, w2))); }
      else { p.a = rotTo(p.a, want, 2.8 * dt); fwd = Math.max(0, Math.cos(d)) ** 2; }
    }
  }
  const target = fwd > 0 ? fwd * 3.4 : fwd * 2.0;
  const acc = target === 0 ? 6 : 4;
  p.speed += clamp(target - p.speed, -acc * dt * 1.5, acc * dt);
  const mx = Math.cos(p.a) * p.speed * dt, my = Math.sin(p.a) * p.speed * dt;
  const ox = p.x, oy = p.y;
  if (moveActor(p, mx, my)) p.speed *= 0.85;
  const moved = Math.hypot(p.x - ox, p.y - oy);
  p.trackD += moved;
  if (p.trackD > 0.13) {
    p.trackD = 0;
    const s = Math.sin(p.a), c = Math.cos(p.a);
    trackMark(p.x - s * 0.31, p.y + c * 0.31); trackMark(p.x + s * 0.31, p.y - c * 0.31);
    if (ZONE.key === 'desert' && Math.random() < 0.5) smoke(p.x - c * 0.5, p.y - s * 0.5, 2, { c: [205, 175, 120], life: 1, size: 6, grow: 12, vz: 6, a: 0.35 });
    if (ZONE.key === 'snow' && Math.random() < 0.4) smoke(p.x - c * 0.5, p.y - s * 0.5, 2, { c: [240, 244, 250], life: 0.9, size: 6, grow: 10, vz: 6, a: 0.4 });
  }
  // Infanterie überrollen
  if (Math.abs(p.speed) > 0.4) for (const e of G.enemies) {
    if (!e.dead && e.type === 'inf' && dist(e.x, e.y, p.x, p.y) < p.r + e.r) killEnemy(e);
  }
  // Turm
  const [ax, ay] = G.aim;
  p.ta = rotTo(p.ta, Math.atan2(ay - p.y, ax - p.x), 5.5 * dt);
  // Waffen
  p.mgCd -= dt; p.gCd -= dt;
  p.heat = Math.max(0, p.heat - (p.over ? 0.42 : 0.3) * dt);
  if (p.over && p.heat < 0.3) p.over = false;
  if (mouse.l && p.mgCd <= 0 && !p.over) {
    fireMG(); p.mgCd = 0.075; p.heat += 0.038;
    if (p.heat >= 1) { p.heat = 1; p.over = true; toast('MG ÜBERHITZT', 1.2); }
  }
  if ((mouse.r || k('Space')) && p.gCd <= 0) {
    if (p.shells > 0) { fireGrenade(); p.shells--; p.gCd = 1.1; }
    else { sfx.click(); toast('KEINE GRANATEN', 1); p.gCd = 0.6; }
  }
  // Pickups
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const u = G.pickups[i];
    if (dist(u.x, u.y, p.x, p.y) < 0.75) {
      if (u.kind === 'repair') { const h = Math.min(35, p.maxHp - p.hp); p.hp += 35; if (p.hp > p.maxHp) p.hp = p.maxHp; floatText(u.x, u.y, 'REPARATUR +' + Math.round(h), '#8fe36a'); }
      else { p.shells = Math.min(p.maxShells, p.shells + 8); floatText(u.x, u.y, 'GRANATEN +8', '#efe0a8'); }
      sfx.pick(); G.pickups.splice(i, 1);
    }
  }
  // Extraktion
  if (G.exitOpen && dist(p.x, p.y, G.exit.x, G.exit.y) < 1.3) levelComplete();
  if (p.flash > 0) p.flash -= dt;
  // Motorsound
  if (engGain) {
    engGain.gain.setTargetAtTime(0.05 + Math.abs(p.speed) * 0.025, AC.currentTime, 0.1);
    engOsc.frequency.setTargetAtTime(34 + Math.abs(p.speed) * 11, AC.currentTime, 0.1);
  }
}

// ---------------------------------------------------------------- Gegner-KI
function steer(e, tx, ty, dt, turn, spd) {
  let want = Math.atan2(ty - e.y, tx - e.x);
  if (e.avoidT > 0) { e.avoidT -= dt; want = e.avoidA; }
  e.a = rotTo(e.a, want, turn * dt);
  const al = Math.cos(angDiff(e.a, want));
  const v = spd * (al > 0.75 ? 1 : al > 0 ? 0.25 : 0);
  const ox = e.x, oy = e.y;
  const bl = moveActor(e, Math.cos(e.a) * v * dt, Math.sin(e.a) * v * dt);
  if (bl && e.avoidT <= 0) { e.avoidT = rnd(0.6, 1.4); e.avoidA = e.a + (Math.random() < 0.5 ? 1 : -1) * rnd(1.2, 2.4); }
  const m = Math.hypot(e.x - ox, e.y - oy);
  e.moving = m > 0.001;
  return m;
}
function patrol(e, dt, spd, turn) {
  e.wpT -= dt;
  if (!e.wp || e.wpT <= 0 || dist(e.x, e.y, e.wp.x, e.wp.y) < 0.5) {
    e.wp = { x: clamp(e.home.x + rnd(-4, 4), 1.5, N - 1.5), y: clamp(e.home.y + rnd(-4, 4), 1.5, N - 1.5) };
    e.wpT = rnd(4, 8);
  }
  return steer(e, e.wp.x, e.wp.y, dt, turn, spd);
}
function sense(e, dt, range) {
  const p = player;
  const d = dist(e.x, e.y, p.x, p.y);
  e.losT -= dt;
  if (e.losT <= 0) { e.losT = 0.2 + Math.random() * 0.1; e.los = !p.dead && d < 14 && hasLOS(e.x, e.y, p.x, p.y); }
  if (!e.alert && !p.dead && ((d < range && e.los) || d < 3.5)) { e.alert = true; alertNear(e.x, e.y, 5); }
  return d;
}
function updateEnemies(dt) {
  const p = player;
  for (const e of G.enemies) {
    if (e.flash > 0) e.flash -= dt;
    if (e.dead) {
      if (e.smokeT > 0) {
        e.smokeT -= dt;
        if (Math.random() < 0.35) smoke(e.x + rnd(-0.2, 0.2), e.y + rnd(-0.2, 0.2), 18, { life: rnd(1.5, 2.5), size: 6, grow: 12, vz: rnd(25, 45), c: [35, 33, 32], a: 0.55 });
        if (e.smokeT > 8 && Math.random() < 0.3) addP({ t: 'f', x: e.x + rnd(-0.2, 0.2), y: e.y + rnd(-0.2, 0.2), z: 16, vx: 0, vy: 0, vz: rnd(20, 50), life: 0.4, max: 0.4, size: rnd(4, 8), grow: 2 });
      }
      continue;
    }
    const dx = p.x - e.x, dy = p.y - e.y;
    const want = Math.atan2(dy, dx);
    if (e.type === 'tank') {
      const d = sense(e, dt, 9.5);
      if (e.alert && !p.dead) {
        e.ta = rotTo(e.ta, want, 1.5 * dt);
        let tx = p.x, ty = p.y;
        if (e.los && d < 7.5) {
          const ang = Math.atan2(e.y - p.y, e.x - p.x) + e.orbit * 0.55;
          tx = p.x + Math.cos(ang) * 5.5; ty = p.y + Math.sin(ang) * 5.5;
        }
        steer(e, tx, ty, dt, 1.4, e.speed);
        e.cd -= dt;
        if (e.cd <= 0 && e.los && d < 10.5 && Math.abs(angDiff(e.ta, want)) < 0.12) { enemyShell(e); e.cd = rnd(2.3, 3.5) / (0.8 + e.dm * 0.2); }
      } else {
        patrol(e, dt, e.speed * 0.45, 1.2);
        e.ta = rotTo(e.ta, e.a, dt);
      }
      if (e.moving) {
        e.trackD += e.speed * dt;
        if (e.trackD > 0.16) { e.trackD = 0; const s = Math.sin(e.a), c = Math.cos(e.a); trackMark(e.x - s * 0.31, e.y + c * 0.31); trackMark(e.x + s * 0.31, e.y - c * 0.31); }
      }
    } else if (e.type === 'inf') {
      const d = sense(e, dt, 8);
      if (e.alert && !p.dead) {
        e.ta = rotTo(e.ta, want, 6 * dt);
        let tx = p.x, ty = p.y;
        if (d < 3) { tx = e.x - dx; ty = e.y - dy; }
        else if (e.los && d < 6.5) { const ang = Math.atan2(e.y - p.y, e.x - p.x) + e.orbit * 0.4; tx = p.x + Math.cos(ang) * 5.5; ty = p.y + Math.sin(ang) * 5.5; }
        const m = steer(e, tx, ty, dt, 8, e.speed);
        e.walk += m * 3;
        e.cd -= dt;
        if (e.cd <= 0 && e.los && d < 8.5) { enemyBullet(e, 0.09, 2.6 * e.dm, 13); e.cd = rnd(0.9, 1.7); }
      } else {
        const m = patrol(e, dt, e.speed * 0.4, 6);
        e.walk += m * 3; e.ta = e.a;
      }
    } else if (e.type === 'bunker') {
      const d = sense(e, dt, 10);
      if (e.alert && !p.dead) {
        e.ta = rotTo(e.ta, want, 1.7 * dt);
        const aligned = Math.abs(angDiff(e.ta, want)) < 0.12;
        if (e.kind === 'mg') {
          if (e.burst > 0) { e.bt -= dt; if (e.bt <= 0) { enemyBullet(e, 0.06, 2.4 * e.dm, 19); e.burst--; e.bt = 0.09; } }
          else { e.cd -= dt; if (e.cd <= 0 && e.los && d < 10 && aligned) { e.burst = 7; e.cd = 2.4; } }
        } else {
          e.cd -= dt;
          if (e.cd <= 0 && e.los && d < 11 && aligned) { enemyShell(e); e.cd = rnd(2.6, 3.4); }
        }
      } else e.ta += dt * 0.4;
    }
  }
}

// ---------------------------------------------------------------- Update
let toastT = 0;
const toastEl = document.getElementById('toast');
function toast(text, dur = 2) { toastEl.textContent = text; toastEl.classList.add('show'); toastT = dur; }

function update(dt) {
  G.time += dt;
  if (G.state === 'play') G.levelTime += dt;
  G.aim = toWorld(mouse.x, mouse.y + 8);
  if (G.state === 'play') updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateParts(dt);
  for (const u of G.pickups) u.t += dt;
  if (G.exitOpen && Math.random() < 0.5) smoke(G.exit.x + rnd(-0.15, 0.15), G.exit.y + rnd(-0.15, 0.15), 4, { c: [90, 230, 110], life: rnd(2, 3), size: 6, grow: 10, vz: rnd(30, 50), a: 0.45 });
  if (G.state === 'dying') {
    G.dyingT -= dt;
    if (Math.random() < 0.5) smoke(player.x, player.y, 16, { life: 2, size: 8, grow: 14, vz: 40, c: [30, 30, 30], a: 0.6 });
    if (G.dyingT <= 0) showDead();
    if (engGain) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.2);
  }
}

// ---------------------------------------------------------------- Zeichnen
function poly(pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
}
function prism(base, z0, h, cTop, cL, cR) {
  const n = base.length;
  let cx = 0, cy = 0;
  for (const b of base) { cx += b[0]; cy += b[1]; }
  cx /= n; cy /= n;
  for (let k = 0; k < n; k++) {
    const a = base[k], b = base[(k + 1) % n];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    if (nx + ny > 1e-4) {
      const l = Math.hypot(nx, ny);
      ctx.fillStyle = (nx - ny) / l > 0.2 ? cR : (ny - nx) / l > 0.2 ? cL : cR;
      poly([P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z0 + h), P(a[0], a[1], z0 + h)]);
      ctx.fill();
    }
  }
  ctx.fillStyle = cTop;
  poly(base.map(b => P(b[0], b[1], z0 + h)));
  ctx.fill();
}
function rectPts(cx, cy, len, wid, a) {
  const c = Math.cos(a), s = Math.sin(a), l = len / 2, w = wid / 2;
  return [[cx + c * l - s * w, cy + s * l + c * w], [cx + c * l + s * w, cy + s * l - c * w], [cx - c * l + s * w, cy - s * l - c * w], [cx - c * l - s * w, cy - s * l + c * w]];
}
function octPts(cx, cy, r, a) {
  const pts = [];
  for (let k = 0; k < 8; k++) { const t = a + k / 8 * TAU + Math.PI / 8; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
  return pts;
}
function shadowAt(x, y, r, a = 0.28) {
  const s = P(x, y);
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(s[0], s[1] + 1, r * HW * 1.414, r * HH * 1.414, 0, 0, TAU); ctx.fill();
}

function drawTank(e, base, enemy) {
  const { x, y, a, ta } = e, dead = e.dead;
  shadowAt(x, y, 0.62);
  const c = dead ? '#2b2927' : (e.flash > 0 ? '#f4efe0' : base);
  const tc = dead ? '#1b1a19' : '#2c2c28';
  const ca = Math.cos(a), sa = Math.sin(a);
  const tr = [-1, 1].map(sd => ({ x: x - sa * 0.31 * sd, y: y + ca * 0.31 * sd })).sort((u, v) => (u.x + u.y) - (v.x + v.y));
  for (const t of tr) prism(rectPts(t.x, t.y, 1.04, 0.2, a), 0, 8, shade(tc, 0.18), shade(tc, 0.05), shade(tc, -0.15));
  prism(rectPts(x, y, 0.94, 0.64, a), 7, 7, shade(c, 0.12), shade(c, -0.12), shade(c, -0.3));
  // Heck-Detail
  prism(rectPts(x - ca * 0.33, y - sa * 0.33, 0.18, 0.5, a), 14, 2, shade(c, -0.15), shade(c, -0.3), shade(c, -0.4));
  const ct = Math.cos(ta), st = Math.sin(ta);
  const back = ct + st < 0;
  const barrel = () => {
    prism(rectPts(x + ct * 0.5, y + st * 0.5, 0.58, 0.08, ta), 17, 3.5, shade(c, 0.05), shade(c, -0.2), shade(c, -0.38));
    prism(rectPts(x + ct * 0.8, y + st * 0.8, 0.08, 0.12, ta), 16.5, 4.5, shade(c, -0.1), shade(c, -0.3), shade(c, -0.45));
  };
  if (back) barrel();
  prism(octPts(x - ct * 0.05, y - st * 0.05, 0.27, ta), 14, 8, shade(c, 0.2), shade(c, -0.04), shade(c, -0.24));
  if (!dead) {
    ctx.fillStyle = enemy ? '#b3271c' : '#e8b93a';
    poly(rectPts(x - ct * 0.17, y - st * 0.17, 0.09, 0.36, ta).map(b => P(b[0], b[1], 22.2)));
    ctx.fill();
    if (!enemy) { // Kommandantenluke
      const h = P(x - ct * 0.02 + st * 0.08, y - st * 0.02 - ct * 0.08, 23);
      ctx.fillStyle = shade(c, -0.25); ctx.beginPath(); ctx.ellipse(h[0], h[1], 5, 2.5, 0, 0, TAU); ctx.fill();
    }
  }
  if (!back) barrel();
}
function drawInf(e) {
  const s = P(e.x, e.y);
  shadowAt(e.x, e.y, 0.14, 0.3);
  const col = e.flash > 0 ? '#ffffff' : ZONE.infCol;
  const sw = e.moving ? Math.sin(e.walk * 4) * 3 : 0;
  ctx.strokeStyle = shade(col, -0.4); ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(s[0] - 1.5, s[1] - 9); ctx.lineTo(s[0] - 1.5 + sw, s[1]); ctx.moveTo(s[0] + 1.5, s[1] - 9); ctx.lineTo(s[0] + 1.5 - sw, s[1]); ctx.stroke();
  ctx.fillStyle = col; ctx.fillRect(s[0] - 4, s[1] - 19, 8, 11);
  ctx.fillStyle = shade(col, -0.2); ctx.fillRect(s[0] - 4, s[1] - 12, 8, 2);
  ctx.fillStyle = '#d8ae88'; ctx.beginPath(); ctx.arc(s[0], s[1] - 22, 3.1, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(col, -0.3); ctx.beginPath(); ctx.arc(s[0], s[1] - 22.6, 3.8, Math.PI, TAU); ctx.fill();
  const g = P(e.x + Math.cos(e.ta) * 0.32, e.y + Math.sin(e.ta) * 0.32, 14);
  ctx.strokeStyle = '#1d1d1b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s[0], s[1] - 14); ctx.lineTo(g[0], g[1]); ctx.stroke();
  ctx.lineCap = 'butt';
}
function drawBunker(e) {
  const c = e.dead ? '#3e3c38' : (e.flash > 0 ? '#f4efe0' : (ZONE.key === 'snow' ? '#a9aba6' : '#8f8b80'));
  shadowAt(e.x, e.y, 0.58);
  prism(octPts(e.x, e.y, 0.5, 0), 0, e.dead ? 6 : 15, shade(c, 0.1), shade(c, -0.12), shade(c, -0.32));
  if (e.dead) return;
  // Sehschlitz-Ring
  prism(octPts(e.x, e.y, 0.42, 0), 15, 2, '#2a2a28', '#2a2a28', '#2a2a28');
  const gc = '#565a55', ct = Math.cos(e.ta), st = Math.sin(e.ta), back = ct + st < 0;
  const barrel = () => {
    const len = e.kind === 'mg' ? 0.5 : 0.62, w = e.kind === 'mg' ? 0.06 : 0.1;
    prism(rectPts(e.x + ct * (0.15 + len / 2), e.y + st * (0.15 + len / 2), len, w, e.ta), 19, 3, shade(gc, 0), shade(gc, -0.2), shade(gc, -0.4));
  };
  if (back) barrel();
  prism(octPts(e.x, e.y, 0.24, e.ta), 17, 7, shade(gc, 0.15), shade(gc, -0.1), shade(gc, -0.3));
  ctx.fillStyle = '#b3271c'; poly(rectPts(e.x - ct * 0.05, e.y - st * 0.05, 0.08, 0.3, e.ta).map(b => P(b[0], b[1], 24.2))); ctx.fill();
  if (!back) barrel();
}
function drawPickup(u) {
  const z = 4 + Math.sin(u.t * 3) * 3;
  shadowAt(u.x, u.y, 0.25, 0.25);
  const c = u.kind === 'repair' ? '#3f7a3a' : '#7a6a32';
  prism(rectPts(u.x, u.y, 0.38, 0.38, u.t * 0.8), z, 11, shade(c, 0.15), shade(c, -0.1), shade(c, -0.3));
  const s = P(u.x, u.y, z + 11);
  ctx.fillStyle = u.kind === 'repair' ? '#f2f2ea' : '#f0c63c';
  if (u.kind === 'repair') { ctx.fillRect(s[0] - 6, s[1] - 1.5, 12, 3); ctx.fillRect(s[0] - 1.5, s[1] - 4, 3, 8); }
  else { for (let k = -1; k <= 1; k++) { ctx.fillRect(s[0] + k * 4 - 1.2, s[1] - 4, 2.4, 7); } }
}

function drawObj(o, i, j) {
  switch (o.k) {
    case 'bld': {
      const m = 0.03, base = [[i + m, j + m], [i + 1 - m, j + m], [i + 1 - m, j + 1 - m], [i + m, j + 1 - m]];
      const dmg = o.hp < o.max * 0.5;
      const c = dmg ? shade(o.col, -0.22) : o.col;
      const cHex = o.col;
      prism(base, 0, o.h, shade(cHex, dmg ? -0.05 : 0.14), shade(cHex, dmg ? -0.3 : -0.08), shade(cHex, dmg ? -0.45 : -0.27));
      if (o.win) {
        // Fenster auf den beiden sichtbaren Seiten
        const floors = Math.floor((o.h - 10) / 13);
        for (let f = 0; f < floors; f++) {
          const z = 8 + f * 13;
          for (const u of [0.22, 0.5, 0.78]) {
            const lit = ((i * 7 + j * 13 + f * 5 + u * 10) | 0) % 11 === 0;
            ctx.fillStyle = lit ? 'rgba(255,214,120,0.85)' : 'rgba(25,28,32,0.75)';
            const xf = i + 1 - m + 0.002, a = j + m + u * (1 - 2 * m);
            poly([P(xf, a - 0.07, z), P(xf, a + 0.07, z), P(xf, a + 0.07, z + 6), P(xf, a - 0.07, z + 6)]); ctx.fill();
            const yf = j + 1 - m + 0.002, b = i + m + u * (1 - 2 * m);
            poly([P(b - 0.07, yf, z), P(b + 0.07, yf, z), P(b + 0.07, yf, z + 6), P(b - 0.07, yf, z + 6)]); ctx.fill();
          }
        }
        if (o.roof) prism(rectPts(i + 0.4, j + 0.4, 0.3, 0.25, 0), o.h, 6, shade(cHex, 0.05), shade(cHex, -0.2), shade(cHex, -0.35));
      } else {
        // Flachdach mit Rand (Lehmbau / Hütte)
        const t = 0.1;
        ctx.fillStyle = shade(cHex, -0.06);
        poly([[i + m + t, j + m + t], [i + 1 - m - t, j + m + t], [i + 1 - m - t, j + 1 - m - t], [i + m + t, j + 1 - m - t]].map(b => P(b[0], b[1], o.h))); ctx.fill();
        // Tür
        ctx.fillStyle = 'rgba(30,22,15,0.8)';
        const yf = j + 1 - m + 0.002;
        poly([P(i + 0.42, yf, 0), P(i + 0.58, yf, 0), P(i + 0.58, yf, 12), P(i + 0.42, yf, 12)]); ctx.fill();
      }
      if (dmg) { const s = P(i + 0.5, j + 0.5, o.h); if (Math.random() < 0.04) smoke(i + 0.5, j + 0.5, o.h, { c: [70, 68, 64], life: 2, size: 6, grow: 12, vz: 20, a: 0.45 }); }
      break;
    }
    case 'tree': {
      const s = P(i + 0.5, j + 0.5), k = o.h, damaged = o.hp < o.max;
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(s[0] + 6, s[1] + 2, 20 * k, 9 * k, 0, 0, TAU); ctx.fill();
      if (o.type === 'palm') {
        const tx = s[0] + (o.s - 0.5) * 22, ty = s[1] - 50 * k;
        ctx.strokeStyle = '#7a5a36'; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.quadraticCurveTo(s[0] + (o.s - 0.5) * 4, s[1] - 28 * k, tx, ty); ctx.stroke();
        ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let f = 0; f < 7; f++) {
          const a = f / 7 * TAU + o.s * 3;
          const ex = tx + Math.cos(a) * 24 * k, ey = ty + Math.sin(a) * 10 * k + 8;
          ctx.strokeStyle = f % 2 ? '#5d8a2e' : '#78a33c';
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + Math.cos(a) * 14 * k, ty + Math.sin(a) * 5 * k - 7, ex, ey); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      } else if (o.type === 'oak' || o.type === 'autumn') {
        ctx.fillStyle = '#5a4128'; ctx.fillRect(s[0] - 2.5, s[1] - 18 * k, 5, 18 * k);
        const g = o.type === 'autumn' ? (o.s < 0.3 ? ['#8a3a18', '#a8481c', '#c4622a'] : o.s < 0.7 ? ['#a0521f', '#c46a26', '#d99036'] : ['#8a7a22', '#a8922a', '#c4ac3a'])
          : damaged ? ['#4a5e2a', '#566c30', '#627838'] : ['#3d6224', '#4b7a2c', '#5e9136'];
        const blobs = [[-9, -26, 14], [9, -28, 14], [0, -38, 15], [0, -28, 12]];
        blobs.forEach((b, n) => { ctx.fillStyle = g[n === 2 ? 2 : n === 3 ? 1 : 0]; ctx.beginPath(); ctx.arc(s[0] + b[0] * k, s[1] + b[1] * k, b[2] * k, 0, TAU); ctx.fill(); });
        ctx.fillStyle = 'rgba(255,255,220,0.12)'; ctx.beginPath(); ctx.arc(s[0] - 3 * k, s[1] - 42 * k, 7 * k, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = '#4b3523'; ctx.fillRect(s[0] - 2, s[1] - 12 * k, 4, 12 * k);
        const snow = ZONE.key === 'snow';
        for (let l = 0; l < 3; l++) {
          const w = (22 - l * 6) * k, yb = s[1] - (8 + l * 13) * k, yt = yb - 20 * k;
          ctx.fillStyle = l === 1 ? '#2e5a3c' : '#26503a';
          ctx.beginPath(); ctx.moveTo(s[0] - w, yb); ctx.lineTo(s[0], yt); ctx.lineTo(s[0] + w, yb); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.beginPath(); ctx.moveTo(s[0], yt); ctx.lineTo(s[0] + w, yb); ctx.lineTo(s[0], yb - 3); ctx.closePath(); ctx.fill();
          if (snow) {
            ctx.fillStyle = '#f2f6f9';
            ctx.beginPath(); ctx.moveTo(s[0] - w * 0.5, yt + 10 * k); ctx.lineTo(s[0], yt); ctx.lineTo(s[0] + w * 0.45, yt + 9 * k); ctx.lineTo(s[0], yt + 6 * k); ctx.closePath(); ctx.fill();
          }
        }
      }
      break;
    }
    case 'rock': {
      const base = o.pts.map(p => [i + 0.5 + p[0], j + 0.5 + p[1]]);
      prism(base, 0, o.h, shade(o.col, ZONE.key === 'snow' ? 0.7 : 0.12), shade(o.col, -0.12), shade(o.col, -0.32));
      break;
    }
    case 'wall': {
      const base = o.dir === 0 ? rectPts(i + 0.5, j + 0.5, 1, 0.32, 0) : rectPts(i + 0.5, j + 0.5, 1, 0.32, Math.PI / 2);
      prism(base, 0, o.h, shade(o.col, ZONE.key === 'snow' ? 0.6 : 0.12), shade(o.col, -0.1), shade(o.col, -0.3));
      break;
    }
    case 'wreck': {
      shadowAt(i + 0.5, j + 0.5, 0.45, 0.25);
      prism(rectPts(i + 0.5, j + 0.5, 0.82, 0.42, o.a), 2, 8, shade(o.col, -0.1), shade(o.col, -0.25), shade(o.col, -0.4));
      prism(rectPts(i + 0.5 - Math.cos(o.a) * 0.05, j + 0.5 - Math.sin(o.a) * 0.05, 0.4, 0.36, o.a), 10, 6, '#2a2a2a', shade(o.col, -0.35), shade(o.col, -0.5));
      break;
    }
    case 'rub': {
      for (const b of o.bits) prism(rectPts(i + b[0], j + b[1], b[2], b[2] * 0.8, b[0] * 5), 0, b[3], shade(o.col, 0.05), shade(o.col, -0.15), shade(o.col, -0.35));
      break;
    }
    case 'stump': {
      const s = P(i + 0.5, j + 0.5);
      const e = P(i + 0.5 + Math.cos(o.a) * 0.7, j + 0.5 + Math.sin(o.a) * 0.7, 3);
      ctx.strokeStyle = o.type === 'pine' ? '#3d4a35' : o.type === 'palm' ? '#7a6a3a' : '#4d5a2e'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s[0], s[1] - 3); ctx.lineTo(e[0], e[1]); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = '#6b4c2e'; ctx.beginPath(); ctx.ellipse(s[0], s[1] - 3, 4, 2, 0, 0, TAU); ctx.fill();
      break;
    }
  }
}

function drawParticles() {
  const ps = G.parts;
  for (const p of ps) {
    if (p.t !== 's' && p.t !== 'd' && p.t !== 'x' && p.t !== 'r') continue;
    const s = P(p.x, p.y, p.z), f = p.life / p.max;
    if (p.t === 's') {
      const r = p.size + p.grow * (p.max - p.life);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${(p.a0 * f).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, TAU); ctx.fill();
    } else if (p.t === 'd') {
      ctx.fillStyle = p.c; ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    } else if (p.t === 'r') {
      const r = p.size + p.grow * (p.max - p.life);
      ctx.strokeStyle = `rgba(255,240,210,${(0.5 * f).toFixed(3)})`; ctx.lineWidth = 3 * f + 1;
      ctx.beginPath(); ctx.ellipse(s[0], s[1], r, r / 2, 0, 0, TAU); ctx.stroke();
    } else if (p.t === 'x') {
      ctx.globalAlpha = Math.min(1, f * 2);
      ctx.font = "16px 'Black Ops One', Impact, sans-serif"; ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(p.text, s[0] + 1, s[1] + 1);
      ctx.fillStyle = p.col; ctx.fillText(p.text, s[0], s[1]);
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const p of ps) {
    if (p.t !== 'f' && p.t !== 'k' && p.t !== 'l') continue;
    const s = P(p.x, p.y, p.z), f = p.life / p.max;
    if (p.t === 'f') {
      const r = p.size + (p.grow || 0) * (p.max - p.life);
      const g = Math.floor(80 + 170 * f);
      ctx.fillStyle = `rgba(255,${g},${Math.floor(40 * f)},${(0.75 * f).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, TAU); ctx.fill();
    } else if (p.t === 'k') {
      const e = P(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.z - p.vz * 0.03);
      ctx.strokeStyle = `rgba(255,220,120,${f.toFixed(3)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    } else {
      const gr = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], p.size);
      gr.addColorStop(0, `rgba(255,240,200,${f.toFixed(3)})`); gr.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s[0], s[1], p.size, 0, TAU); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawExit() {
  if (!G.exitOpen) return;
  const { x, y } = G.exit, pulse = (Math.sin(G.time * 4) + 1) / 2;
  for (let k = 0; k < 3; k++) {
    const r = 0.6 + k * 0.45 + pulse * 0.2, s = P(x, y);
    ctx.strokeStyle = `rgba(110,240,120,${0.75 - k * 0.2})`; ctx.lineWidth = 3 - k * 0.7;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], r * HW * 1.414, r * HH * 1.414, 0, 0, TAU); ctx.stroke();
  }
  const s = P(x, y);
  ctx.fillStyle = 'rgba(110,240,120,0.18)';
  ctx.beginPath(); ctx.ellipse(s[0], s[1], 1.3 * HW * 1.414, 1.3 * HH * 1.414, 0, 0, TAU); ctx.fill();
  ctx.font = "14px 'Black Ops One', Impact, sans-serif"; ctx.textAlign = 'center';
  ctx.fillStyle = '#9ff0a0'; ctx.fillText(ZONE.exitAlways ? 'ZUHAUSE' : 'EXTRAKTION', s[0], s[1] + 46);
  if (ZONE.exitAlways) {   // Fahnenmast
    const b = P(x + 0.9, y - 0.9), tp = P(x + 0.9, y - 0.9, 80);
    ctx.strokeStyle = '#d8d4c8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(tp[0], tp[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tp[0], tp[1]);
    for (let q = 0; q <= 10; q++) ctx.lineTo(tp[0] + q * 4, tp[1] + Math.sin(G.time * 5 + q * 0.7) * 2.5);
    for (let q = 10; q >= 0; q--) ctx.lineTo(tp[0] + q * 4, tp[1] + 22 + Math.sin(G.time * 5 + q * 0.7) * 2.5);
    ctx.closePath(); ctx.fillStyle = '#e8b93a'; ctx.fill();
  }
}

function drawAimAndHud() {
  const p = player;
  if (G.state !== 'play' || p.dead) return;
  // Granaten-Zielpunkt
  let [ax, ay] = G.aim;
  let dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy);
  const out = d > 10;
  if (out) { ax = p.x + dx / d * 10; ay = p.y + dy / d * 10; }
  const s = P(ax, ay);
  const ready = p.gCd <= 0 && p.shells > 0;
  ctx.strokeStyle = out ? 'rgba(230,70,50,0.6)' : ready ? 'rgba(232,185,58,0.6)' : 'rgba(232,185,58,0.25)';
  ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(s[0], s[1], 1.7 * HW * 1.414, 1.7 * HH * 1.414, 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // Fadenkreuz
  const mx = mouse.x, my = mouse.y;
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  const cross = () => {
    ctx.beginPath();
    ctx.moveTo(mx - 16, my); ctx.lineTo(mx - 6, my); ctx.moveTo(mx + 6, my); ctx.lineTo(mx + 16, my);
    ctx.moveTo(mx, my - 16); ctx.lineTo(mx, my - 6); ctx.moveTo(mx, my + 6); ctx.lineTo(mx, my + 16);
    ctx.stroke();
  };
  cross(); ctx.strokeStyle = p.over ? '#ff5533' : '#f3ecd6'; ctx.lineWidth = 2; cross();
  // Nachlade-Ring
  const prog = p.shells > 0 ? 1 - clamp(p.gCd / 1.1, 0, 1) : 0;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(mx, my, 21, 0, TAU); ctx.stroke();
  ctx.strokeStyle = prog >= 1 ? '#e8b93a' : 'rgba(232,185,58,0.6)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(mx, my, 21, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
  // Hitze-Bogen
  if (p.heat > 0.02) {
    ctx.strokeStyle = p.over ? '#ff3b22' : `rgba(255,${Math.floor(200 - p.heat * 140)},60,0.9)`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(mx, my, 27, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 0.5 * p.heat); ctx.stroke();
  }
}

function drawIndicator(x, y, col, label) {
  const s = P(x, y);
  const m = 40;
  if (s[0] > m && s[0] < W - m && s[1] > m && s[1] < H - m) return;
  const cx = W / 2, cy = H / 2, dx = s[0] - cx, dy = s[1] - cy;
  const k = Math.min((W / 2 - m) / Math.abs(dx || 1), (H / 2 - m) / Math.abs(dy || 1));
  const px = cx + dx * k, py = cy + dy * k, a = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(px, py); ctx.rotate(a);
  ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-4, 0); ctx.lineTo(-8, 10); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
  if (label) {
    ctx.font = "12px 'Share Tech Mono', monospace"; ctx.textAlign = 'center'; ctx.fillStyle = col;
    ctx.fillText(label, px - Math.cos(a) * 26, py - Math.sin(a) * 26 + 4);
  }
}

const drawList = [];
function render(dt) {
  ctx.setTransform(DPR * ZOOM, 0, 0, DPR * ZOOM, 0, 0);
  ctx.fillStyle = ZONE.bg; ctx.fillRect(0, 0, W, H);
  // Kamera
  let tx, ty;
  if (G.state === 'menu') {
    const t = G.time * 0.05;
    const wx = N / 2 + Math.cos(t) * N * 0.25, wy = N / 2 + Math.sin(t) * N * 0.25;
    tx = (wx - wy) * HW; ty = (wx + wy) * HH;
  } else {
    tx = (player.x - player.y) * HW; ty = (player.x + player.y) * HH;
    if (G.state === 'play') { tx += (mouse.x - W / 2) * 0.2; ty += (mouse.y - H / 2) * 0.2; }
  }
  const cl = G.state === 'menu' ? 0.02 : Math.min(1, dt * 5);
  camX += (tx - camX) * cl; camY += (ty - camY) * cl;
  G.shake *= Math.pow(0.002, dt);
  rcx = camX + (Math.random() - 0.5) * G.shake; rcy = camY + (Math.random() - 0.5) * G.shake;

  ctx.drawImage(ground, W / 2 - rcx - GOX, H / 2 - rcy - GOY);
  drawExit();

  // Tiefensortierte Liste
  drawList.length = 0;
  const ps = P(player.x, player.y, 12);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = tiles[j * N + i];
    if (!t.o) continue;
    const s = P(i + 0.5, j + 0.5);
    if (s[0] < -90 || s[0] > W + 90 || s[1] < -40 || s[1] - 150 > H) continue;
    let alpha = 1;
    const o = t.o;
    if ((o.k === 'bld' || o.k === 'tree') && G.state !== 'menu') {
      const hgt = o.k === 'bld' ? o.h : 55 * o.h;
      if (i + j + 1 > player.x + player.y + 0.2 && Math.abs(ps[0] - s[0]) < HW + 18 && ps[1] < s[1] + 8 && ps[1] > s[1] - hgt - 30) alpha = 0.32;
    }
    drawList.push({ k: i + j + (o.solid ? 1 : 0.6), type: 0, o, i, j, alpha });
  }
  if (!player.dead || G.state === 'dying') drawList.push({ k: player.x + player.y, type: 1, e: player });
  for (const e of G.enemies) {
    if (e.dead && e.type === 'inf') continue;
    drawList.push({ k: e.x + e.y - (e.dead ? 0.3 : 0), type: 2, e });
  }
  for (const u of G.pickups) drawList.push({ k: u.x + u.y, type: 3, e: u });
  for (const g of G.grenades) drawList.push({ k: g.x + g.y, type: 4, e: g });
  drawList.sort((a, b) => a.k - b.k);

  // Granatenschatten zuerst
  for (const g of G.grenades) shadowAt(g.x, g.y, 0.12, 0.3);

  for (const d of drawList) {
    switch (d.type) {
      case 0:
        if (d.alpha < 1) ctx.globalAlpha = d.alpha;
        drawObj(d.o, d.i, d.j);
        ctx.globalAlpha = 1;
        break;
      case 1:
        if (player.dead) { drawTank({ ...player, dead: true }, '#556b33', false); }
        else drawTank(player, player.flash > 0.15 ? '#d7d0b8' : '#5a6e35', false);
        break;
      case 2: {
        const e = d.e;
        if (e.type === 'tank') drawTank(e, ZONE.tankCol, true);
        else if (e.type === 'inf') drawInf(e);
        else drawBunker(e);
        if (!e.dead && e.hp < e.max) {
          const s = P(e.x, e.y, e.type === 'inf' ? 32 : 36), w = e.type === 'inf' ? 18 : 34;
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(s[0] - w / 2 - 1, s[1] - 1, w + 2, 5);
          ctx.fillStyle = e.hp / e.max > 0.35 ? '#e8b93a' : '#e2553f'; ctx.fillRect(s[0] - w / 2, s[1], w * e.hp / e.max, 3);
        }
        break;
      }
      case 3: drawPickup(d.e); break;
      case 4: {
        const g = d.e, s = P(g.x, g.y, g.z);
        ctx.fillStyle = '#2a2a24'; ctx.beginPath(); ctx.arc(s[0], s[1], 3.5, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,90,0.9)'; ctx.beginPath(); ctx.arc(s[0], s[1], 1.6, 0, TAU); ctx.fill();
        break;
      }
    }
  }
  // Projektile
  ctx.lineCap = 'round';
  for (const b of G.bullets) {
    const s = P(b.x, b.y, b.z), e = P(b.x - b.vx * 0.035, b.y - b.vy * 0.035, b.z);
    ctx.strokeStyle = b.from === 'p' ? '#ffe9a0' : '#ff8a5a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  for (const sh of G.shells) {
    const s = P(sh.x, sh.y, sh.z);
    ctx.fillStyle = '#ffb35a'; ctx.beginPath(); ctx.arc(s[0], s[1], 3.5, 0, TAU); ctx.fill();
  }
  ctx.lineCap = 'butt';
  drawParticles();

  // Zonen-Atmosphäre
  ctx.fillStyle = ZONE.tint; ctx.fillRect(0, 0, W, H);
  if (G.flakes.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const f of G.flakes) {
      f.y += f.v * dt; f.x += Math.sin(G.time + f.s * 5) * 12 * dt - 8 * dt;
      if (f.y > H) { f.y = -5; f.x = Math.random() * W; }
      if (f.x < -5) f.x = W + 5;
      ctx.fillRect(f.x, f.y, f.s * 1.5, f.s * 1.5);
    }
  }
  ctx.drawImage(vignette, 0, 0, W, H);
  if (player.flash > 0 && !player.dead) {
    ctx.fillStyle = `rgba(200,30,20,${Math.min(0.35, player.flash)})`; ctx.fillRect(0, 0, W, H);
  }
  if (G.state === 'play' && player.hp < 30) {
    ctx.fillStyle = `rgba(160,20,10,${0.12 + Math.sin(G.time * 6) * 0.06})`; ctx.fillRect(0, 0, W, H);
  }

  if (G.state === 'play') {
    if (G.exitOpen) drawIndicator(G.exit.x, G.exit.y, '#8fe36a', ZONE.exitAlways ? 'HOME' : 'EXFIL');
    else if (objectivesLeft() <= 3) for (const e of G.enemies) if (!e.dead && e.type !== 'inf') drawIndicator(e.x, e.y, '#e2553f', '');
  }
  drawAimAndHud();
  updateHud();
  drawMinimap();
}

// ---------------------------------------------------------------- HUD & Minimap
const $ = id => document.getElementById(id);
const hudEl = $('hud'), hpBar = $('hpBar'), hpTxt = $('hpTxt'), heatBar = $('heatBar'), heatTxt = $('heatTxt'), grBar = $('grBar'), grTxt = $('grTxt');
const scoreEl = $('score'), zoneName = $('zoneName'), zoneTag = $('zoneTag'), zoneObj = $('zoneObj');
const mini = $('mini'), mctx = mini.getContext('2d');
let mmStatic = null;
function updateHud() {
  if (G.state === 'menu') return;
  const p = player;
  hpBar.style.width = (p.hp / p.maxHp * 100) + '%';
  hpBar.parentElement.classList.toggle('low', p.hp < 30);
  hpTxt.textContent = Math.ceil(p.hp);
  heatBar.style.width = (p.heat * 100) + '%';
  heatBar.parentElement.classList.toggle('over', p.over);
  heatTxt.textContent = p.over ? 'HEISS' : 'OK';
  grBar.style.width = (p.shells > 0 ? (1 - clamp(p.gCd / 1.1, 0, 1)) * 100 : 0) + '%';
  grTxt.textContent = p.shells;
  scoreEl.textContent = G.score;
  const left = objectivesLeft();
  zoneObj.textContent = ZONE.exitAlways ? `HEIMWEG: NOCH ${(dist(p.x, p.y, G.exit.x, G.exit.y) * 0.025).toFixed(1).replace('.', ',')} KM · ZIELE ${G.objTotal - left}/${G.objTotal}`
    : G.exitOpen ? '▶ ZUR EXTRAKTION' : `ZIELE: ${G.objTotal - left} / ${G.objTotal}`;
  zoneObj.classList.toggle('done', G.exitOpen && !ZONE.exitAlways);
  if (toastT > 0) { toastT -= 1 / 60; if (toastT <= 0) toastEl.classList.remove('show'); }
}
function drawMinimap() {
  if (G.state === 'menu') return;
  const S = 360, a = (S / 2) / N, b = a / 2, ox = S / 2, oy = S / 4;
  if (G.mmDirty || !mmStatic) {
    G.mmDirty = false;
    mmStatic = mmStatic || document.createElement('canvas');
    mmStatic.width = S; mmStatic.height = S;
    const m = mmStatic.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, S, S);
    m.setTransform(a, b, -a, b, ox, oy);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const t = tiles[j * N + i];
      let c = groundColor(t);
      if (t.o) {
        if (t.o.k === 'bld') c = '#2a2824';
        else if (t.o.k === 'tree') c = '#25421f';
        else if (t.o.solid) c = '#4c4a44';
      }
      m.fillStyle = c; m.fillRect(i, j, 1.05, 1.05);
    }
    m.setTransform(1, 0, 0, 1, 0, 0);
  }
  mctx.clearRect(0, 0, S, S);
  mctx.globalAlpha = 0.9; mctx.drawImage(mmStatic, 0, 0); mctx.globalAlpha = 1;
  const M = (x, y) => [(x - y) * a + ox, (x + y) * b + oy];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const [x, y] = M(e.x, e.y);
    mctx.fillStyle = e.type === 'inf' ? '#ff9a7a' : '#ff3322';
    const r = e.type === 'inf' ? 3 : 6;
    mctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  for (const u of G.pickups) { const [x, y] = M(u.x, u.y); mctx.fillStyle = u.kind === 'repair' ? '#9ff0a0' : '#f0d070'; mctx.fillRect(x - 2.5, y - 2.5, 5, 5); }
  if (G.exitOpen) {
    const [x, y] = M(G.exit.x, G.exit.y);
    mctx.strokeStyle = '#8fe36a'; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.arc(x, y, 8 + Math.sin(G.time * 5) * 3, 0, TAU); mctx.stroke();
  }
  const [px, py] = M(player.x, player.y);
  mctx.save(); mctx.translate(px, py);
  const dir = M(player.x + Math.cos(player.a), player.y + Math.sin(player.a));
  mctx.rotate(Math.atan2(dir[1] - py, dir[0] - px));
  mctx.fillStyle = '#e8b93a'; mctx.strokeStyle = '#000'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(10, 0); mctx.lineTo(-7, -7); mctx.lineTo(-7, 7); mctx.closePath(); mctx.stroke(); mctx.fill();
  mctx.restore();
}

// ---------------------------------------------------------------- Screens / Ablauf
const ov = $('overlay');
function showOverlay(html) { ov.innerHTML = `<div class="panel">${html}</div>`; ov.classList.add('show'); }
function hideOverlay() { ov.classList.remove('show'); }
ov.addEventListener('dblclick', e => { if (G.state === 'menu' && e.target.closest('.world')) { initAudio(); act('start'); } });
ov.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { initAudio(); act(b.dataset.act); } });

function ctrlLabel() { return G.ctrl === 'tank' ? 'PANZER (W/S Gas · A/D drehen)' : 'DIREKT (WASD = Bildschirmrichtung)'; }
function showMenu() {
  G.state = 'menu'; hudEl.classList.add('hidden');
  if (engGain) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.2);
  showOverlay(`
    <div class="kicker">ISOMETRISCHE PANZERSCHLACHT</div>
    <h1>PANZERPANZER</h1>
    <div class="sub">${ZONES.length} KRIEGSGEBIETE · EIN PANZER · KEIN RÜCKZUG</div>
    <div class="controls">
      <b>W A S D / Pfeile</b><span>Fahren</span>
      <b>Maus</b><span>Turm ausrichten &amp; zielen</span>
      <b>Linke Maustaste</b><span>Maschinengewehr – stark gegen Infanterie, überhitzt</span>
      <b>Rechte Maustaste / Leertaste</b><span>Granate – Bogenschuss mit Flächenschaden, zerstört Gebäude</span>
      <b>C · M · P/Esc</b><span>Steuerungsmodus · Ton · Pause</span>
    </div>
    <div class="kicker">WELT WÄHLEN</div>
    <div class="worlds" style="grid-template-columns:repeat(${ZONES.length},1fr)">${ZONES.map((z, i) => `
      <div class="world${i === G.sel ? ' sel' : ''}" data-act="sel:${i}" style="--zc:${z.ground[0]};--zd:${z.ground[3]};--zw:${z.water}">
        <div class="wnum">${i + 1}</div>${worldsDone[z.key] ? '<div class="wdone" title="abgeschlossen">✓</div>' : ''}
        <div class="wname">${z.name}</div>
        <div class="wtitle">${z.title}</div>
        <div class="wdiff">${'■'.repeat(i + 1)}${'□'.repeat(ZONES.length - 1 - i)}</div>
      </div>`).join('')}
    </div>
    <p class="wbrief">${ZONES[G.sel].brief}</p>
    <div class="btns">
      <button data-act="start">${ZONES[G.sel].name} STARTEN</button>
      <button class="ghost" data-act="ctrl">Steuerung: ${ctrlLabel()}</button>
    </div>
    <div class="hint">${best ? 'BESTWERT: ' + best + ' PUNKTE · ' : ''}1–${ZONES.length} WELT WÄHLEN · ENTER ZUM STARTEN</div>`);
}
function showBrief() {
  G.state = 'brief'; hudEl.classList.remove('hidden');
  zoneName.textContent = ZONE.name; zoneTag.textContent = `EINSATZ ${G.level + 1}/${ZONES.length}`;
  showOverlay(`
    <div class="kicker">EINSATZ ${G.level + 1} / ${ZONES.length} · ${ZONE.name}</div>
    <h2>${ZONE.title}</h2>
    <p class="brief">${ZONE.brief}</p>
    <div class="stats">
      <div><label>PANZER</label><b>${ZONE.tanks}</b></div>
      <div><label>BUNKER</label><b>${ZONE.bunkers}</b></div>
      <div><label>INFANTERIE</label><b>~${ZONE.inf}</b></div>
    </div>
    <div class="btns"><button data-act="go">LOS GEHT'S</button></div>
    <div class="hint">${ZONE.exitAlways ? 'ZIEL: GERADEAUS NACH NORDEN – NACH HAUSE KOMMEN' : 'ZIEL: ALLE PANZER UND BUNKER VERNICHTEN · DANN ZUR EXTRAKTION'} · ENTER</div>`);
}
function startPlay() { hideOverlay(); G.state = 'play'; mouse.l = mouse.r = false; toast(ZONE.title.toUpperCase(), 2.2); }
function pauseGame() {
  G.state = 'pause';
  if (engGain) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.1);
  showOverlay(`<div class="kicker">${ZONE.name}</div><h2>PAUSE</h2>
    <p class="brief">Steuerung: ${ctrlLabel()}</p>
    <div class="btns"><button data-act="resume">WEITER</button><button class="ghost" data-act="ctrl">Steuerung wechseln</button><button class="ghost" data-act="menu">Hauptmenü</button></div>
    <div class="hint">P / ESC ZUM FORTSETZEN</div>`);
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }
function levelComplete() {
  G.state = 'done';
  const bonus = Math.max(0, Math.round(1500 - G.levelTime * 5)) + Math.round(player.hp * 5);
  G.score += bonus;
  if (engGain) engGain.gain.setTargetAtTime(0, AC.currentTime, 0.2);
  worldsDone[ZONE.key] = true; localStorage.setItem('panzerpanzer_done', JSON.stringify(worldsDone));
  const last = G.level >= ZONES.length - 1;
  if (last) { showWin(bonus); return; }
  const nextZ = ZONES[G.level + 1];
  showOverlay(`<div class="kicker">EINSATZ ${G.level + 1} ABGESCHLOSSEN</div><h2>ZONE GESÄUBERT</h2>
    <div class="stats">
      <div><label>ZEIT</label><b>${fmtTime(G.levelTime)}</b></div>
      <div><label>ABSCHÜSSE</label><b>${G.kills}</b></div>
      <div><label>BONUS</label><b>+${bonus}</b></div>
    </div>
    <p class="brief">Panzer wird teilweise instand gesetzt und mit Granaten aufmunitioniert.</p>
    <div class="btns"><button data-act="next">WEITER: ${nextZ.name}</button><button class="ghost" data-act="menu">Weltauswahl</button></div>
    <div class="hint">PUNKTE: ${G.score} · ENTER</div>`);
}
function saveBest() { if (G.score > best) { best = G.score; localStorage.setItem('panzerpanzer_best', best); return true; } return false; }
function showWin(bonus) {
  G.state = 'win';
  const nb = saveBest();
  showOverlay(`<div class="kicker">LETZTES EINSATZGEBIET GESÄUBERT</div><h1>SIEG!</h1>
    <div class="sub">DER KRIEG IST VORBEI, KOMMANDANT.</div>
    <div class="stats">
      <div><label>LETZTER BONUS</label><b>+${bonus}</b></div>
      <div><label>ENDSTAND</label><b>${G.score}</b></div>
      <div><label>BESTWERT</label><b>${best}${nb ? ' ★' : ''}</b></div>
    </div>
    <div class="btns"><button data-act="menu">ZUR WELTAUSWAHL</button></div>`);
}
function showDead() {
  G.state = 'dead';
  showOverlay(`<div class="kicker">${ZONE.name} · EINSATZ ${G.level + 1}</div><h1 class="red">PANZER ZERSTÖRT</h1>
    <div class="stats">
      <div><label>ZEIT</label><b>${fmtTime(G.levelTime)}</b></div>
      <div><label>ABSCHÜSSE</label><b>${G.kills}</b></div>
      <div><label>PUNKTE</label><b>${G.score}</b></div>
    </div>
    <div class="btns"><button data-act="retry">EINSATZ WIEDERHOLEN</button><button class="ghost" data-act="menu">Hauptmenü</button></div>
    <div class="hint">R / ENTER ZUM WIEDERHOLEN</div>`);
}
function act(a) {
  if (a.startsWith('sel:')) {
    const i = +a.slice(4);
    if (i !== G.sel) { G.sel = i; localStorage.setItem('panzerpanzer_sel', i); loadLevel(i, true); }
    showMenu(); return;
  }
  switch (a) {
    case 'start': G.score = 0; loadLevel(G.sel, true); showBrief(); break;
    case 'go': startPlay(); break;
    case 'resume': startPlay(); break;
    case 'menu': saveBest(); loadLevel(G.sel, true); showMenu(); break;
    case 'ctrl': G.ctrl = G.ctrl === 'tank' ? 'direct' : 'tank'; localStorage.setItem('panzerpanzer_ctrl', G.ctrl);
      if (G.state === 'menu') showMenu(); else if (G.state === 'pause') pauseGame(); break;
    case 'next': {
      const hp = Math.min(player.maxHp, player.hp + 50), sh = Math.max(player.shells, 25);
      loadLevel(G.level + 1); player.hp = hp; player.shells = sh; showBrief(); break;
    }
    case 'retry': G.score = G.levelStartScore; { const li = G.level; loadLevel(li, true); } showBrief(); break;
  }
}
function onKey(code) {
  if (code === 'KeyM') { initAudio(); setMuted(!muted); return; }
  if (code === 'KeyC' && (G.state === 'play' || G.state === 'pause' || G.state === 'menu')) {
    if (G.state === 'play') { G.ctrl = G.ctrl === 'tank' ? 'direct' : 'tank'; localStorage.setItem('panzerpanzer_ctrl', G.ctrl); toast('STEUERUNG: ' + (G.ctrl === 'tank' ? 'PANZER' : 'DIREKT'), 1.5); }
    else act('ctrl');
    return;
  }
  if (code === 'KeyP' || code === 'Escape') { if (G.state === 'play') pauseGame(); else if (G.state === 'pause') startPlay(); return; }
  if (code === 'Enter' || code === 'NumpadEnter') {
    initAudio();
    const map = { menu: 'start', brief: 'go', pause: 'resume', done: 'next', dead: 'retry', win: 'menu' };
    if (map[G.state]) act(map[G.state]);
    return;
  }
  if (code === 'KeyR' && G.state === 'dead') act('retry');
  if (G.state === 'menu' && /^Digit[1-9]$/.test(code)) { const i = +code[5] - 1; if (i < ZONES.length) act('sel:' + i); }
  if (G.state === 'menu' && (code === 'ArrowRight' || code === 'ArrowLeft')) act('sel:' + ((G.sel + (code === 'ArrowRight' ? 1 : ZONES.length - 1)) % ZONES.length));
}

// ---------------------------------------------------------------- Start
G.ctrl = localStorage.getItem('panzerpanzer_ctrl') || 'tank';
G.sel = clamp(+(localStorage.getItem('panzerpanzer_sel') || 0), 0, ZONES.length - 1);
loadLevel(G.sel, true);
showMenu();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (G.state === 'play' || G.state === 'dying') update(dt);
  else if (G.state !== 'pause') { G.time += dt; updateParts(dt); }
  render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
