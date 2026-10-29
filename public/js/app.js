// 五声工坊 · 交互层
import { Player } from './player.js';
import { compose } from './composer.js';
import { audioBufferToWav, downloadBlob } from './wav.js';
import { downloadMidi } from './midi.js';
import { INSTRUMENTS, renderDemo } from './synth.js';
import { Rng } from './rng.js';
import {
  MOODS, MOOD_BY_ID, MODES, KEYS, DEGREES, JIANPU, analyzeInspiration,
  stepToMidi, midiToFreq, stepDegree, stepOctave, stepName,
} from './theory.js';

const $ = id => document.getElementById(id);
const player = new Player();
let piece = null;
let settings = loadSettings();
let keyOctave = 1;
let hoverNote = null;
let lastPainted = -1;

/* ---------------- 设置持久化 ---------------- */
function loadSettings() {
  const def = { inspire: '', mood: 'qingya', mode: 0, key: 'C', bpm: 68, density: 55, length: 'normal', seed: '' };
  try { return { ...def, ...JSON.parse(localStorage.getItem('ws.settings.v1') || '{}') }; } catch (e) { return def; }
}
function saveSettings() {
  try { localStorage.setItem('ws.settings.v1', JSON.stringify(settings)); } catch (e) { }
}
function library() {
  try { return JSON.parse(localStorage.getItem('ws.library.v1') || '[]'); } catch (e) { return []; }
}
function setLibrary(list) {
  try { localStorage.setItem('ws.library.v1', JSON.stringify(list.slice(0, 24))); } catch (e) { toast('本地存储已满，先删几首旧作品'); }
}

/* ---------------- 工具 ---------------- */
function fmt(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function sanitize(s) { return (s || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }
let toastTimer = null;
function toast(msg, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const hexA = (hex, a) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

/* ---------------- 初始化控件 ---------------- */
function initControls() {
  $('mode').innerHTML = MODES.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
  $('key').innerHTML = KEYS.map(k => `<option value="${k.name}">${k.name} 为主音</option>`).join('');
  $('length').innerHTML = [['short', '短曲 · 12 小节'], ['normal', '标准 · 20 小节'], ['long', '长曲 · 24 小节']]
    .map(([v, n]) => `<option value="${v}">${n}</option>`).join('');

  $('moodChips').innerHTML = MOODS.map(m =>
    `<button class="chip" data-mood="${m.id}" title="${m.desc}">${m.name}</button>`).join('');

  $('timbreList').innerHTML = Object.entries(INSTRUMENTS).map(([id, ins]) => `
    <button class="timbre" data-inst="${id}" style="--c:${ins.color}" title="${ins.desc}">
      <span class="dotc"></span>
      <span class="nm">${ins.name}</span>
      <span class="ds">${ins.desc.split('·')[0].trim()}</span>
      <span class="play">▶</span>
    </button>`).join('');

  syncUI();
}
function syncUI() {
  $('inspire').value = settings.inspire;
  $('mode').value = String(settings.mode);
  $('key').value = settings.key;
  $('bpm').value = settings.bpm; $('bpmVal').textContent = settings.bpm;
  $('density').value = settings.density; $('densityVal').textContent = settings.density + '%';
  $('length').value = settings.length;
  $('seed').value = settings.seed;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.mood === settings.mood));
}

/* ---------------- 五声键盘 ---------------- */
const KEYMAP = { a: 0, s: 1, d: 2, f: 3, g: 4, q: 5, w: 6, e: 7, r: 8, t: 9 };
function currentRoot() { return piece ? piece.meta.rootMidi : (KEYS.find(k => k.name === settings.key) || KEYS[0]).midi; }
function buildKeys() {
  const base = (keyOctave - 1) * 5;
  const labels = ['低音区', '中音区', '高音区'];
  $('octLabel').textContent = labels[keyOctave];
  const hint = ['A', 'S', 'D', 'F', 'G', 'Q', 'W', 'E', 'R', 'T'];
  let html = '';
  for (let i = 0; i < 10; i++) {
    const step = base + i;
    const d = stepDegree(step);
    html += `<button class="key ${i >= 5 ? 'upper' : ''}" data-step="${step}">
      <span class="kk">${hint[i]}</span>
      <span class="kn">${DEGREES[d]}</span>
      <span class="kj">${JIANPU[d]}${'·'.repeat(Math.max(0, stepOctave(step)))}</span>
    </button>`;
  }
  $('keys').innerHTML = html;
  $('keys').querySelectorAll('.key').forEach(k => {
    k.addEventListener('pointerdown', e => { e.preventDefault(); playPad(Number(k.dataset.step), k); });
  });
}
async function playPad(step, elm) {
  const midi = stepToMidi(step, currentRoot());
  const inst = piece ? (piece.notes.find(n => n.track === 'lead')?.inst || 'guzheng') : 'guzheng';
  if (elm) { elm.classList.add('active'); setTimeout(() => elm.classList.remove('active'), 170); }
  try { await player.trigger(inst, midiToFreq(midi), 0.95, 0.9); } catch (e) { toast('音频启动失败，点一下页面再试'); }
}

/* ---------------- 生成 ---------------- */
function readForm() {
  settings.inspire = $('inspire').value.trim();
  settings.mode = Number($('mode').value);
  settings.key = $('key').value;
  settings.bpm = Number($('bpm').value);
  settings.density = Number($('density').value);
  settings.length = $('length').value;
  settings.seed = $('seed').value.trim();
  return settings;
}

async function generate(auto = false) {
  const s = readForm();
  const parsed = analyzeInspiration(s.inspire);
  if (parsed.mood) { settings.mood = parsed.mood; }
  if (parsed.mode != null && s.mode === 0) { settings.mode = parsed.mode; }
  if (parsed.key && s.key === 'C') { settings.key = parsed.key; }
  syncUI();

  const btn = $('btnGenerate');
  btn.disabled = true; btn.querySelector('span').textContent = '编曲中…';
  const bar = $('genProgress').firstElementChild;
  bar.style.width = '4%';

  try {
    const seed = s.seed !== '' ? Number(s.seed) : Math.floor(Math.random() * 1e9);
    const p = compose({
      mood: settings.mood, mode: settings.mode, key: settings.key,
      bpm: s.bpm, density: s.density / 100, length: s.length, seed,
    });
    await player.build(p, prog => { bar.style.width = (4 + prog * 96) + '%'; });
    piece = p;
    player.stop(); player.playing = false;
    resetMix();
    bar.style.width = '100%';
    renderAll();
    if (window.innerWidth < 1120) {
      setTimeout(() => document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
    if (parsed.mood) {
      toast(`灵感解析：${MOOD_BY_ID[parsed.mood].name} · ${p.meta.key} ${p.meta.modeName}`, 3000);
    } else if (!auto) {
      toast(`已生成《${p.meta.title}》· ${p.meta.modeName}`);
    }
    history.replaceState(null, '', '#' + new URLSearchParams({
      seed, mood: settings.mood, mode: settings.mode, key: settings.key,
      bpm: s.bpm, density: s.density, len: s.length,
    }).toString());
  } catch (err) {
    console.error(err);
    toast('生成失败：' + err.message, 4000);
  } finally {
    btn.disabled = false; btn.querySelector('span').textContent = '生成编曲';
    setTimeout(() => { bar.style.width = '0'; }, 600);
  }
}

/* ---------------- 渲染界面 ---------------- */
function setPiece(p) {
  piece = p;
  resetMix();
  renderAll();
}

function resetMix() {
  player.mute.clear();
  player.solo = null;
  $('btnPlay').textContent = '▶';
  $('btnPlay').classList.remove('playing');
}

function renderAll() {
  if (!piece) return;
  const m = piece.meta;
  $('title').textContent = m.title;
  $('desc').textContent = m.desc;
  $('mTempo').textContent = m.bpm;
  $('mDur').textContent = fmt(player.duration || m.duration);
  $('mBars').textContent = m.bars;
  $('mNotes').textContent = piece.notes.length;
  $('tTotal').textContent = fmt(player.duration || m.duration);
  $('tNow').textContent = '0:00';
  $('rollEmpty').classList.add('hide');
  renderTracks();
  buildKeys();
  layoutRoll();
  drawStatic();
  paint();
}

function renderTracks() {
  const wrap = $('tracks');
  wrap.innerHTML = piece.tracks.map(t => {
    const first = piece.notes.find(n => n.track === t.id);
    const ins = first ? INSTRUMENTS[first.inst] : null;
    return `<div class="track" data-track="${t.id}" style="--c:${t.color}">
      <span class="bar-c"></span>
      <div><div class="tn">${t.name}</div><div class="ti">${ins ? ins.name : ''}</div></div>
      <div class="btns">
        <button class="mute" data-act="mute" data-id="${t.id}" title="静音">M</button>
        <button data-act="solo" data-id="${t.id}" title="独奏">S</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (b.dataset.act === 'mute') {
        const on = !player.mute.has(id);
        player.setMute(id, on);
        b.classList.toggle('on', on);
      } else {
        const on = player.solo !== id;
        player.setSolo(on ? id : null);
        wrap.querySelectorAll('[data-act=solo]').forEach(x => x.classList.toggle('on', on && x.dataset.id === id));
      }
    });
  });
}

/* ---------------- 卷帘 ---------------- */
const roll = $('roll');
const rollCtx = roll.getContext('2d');
const staticCanvas = document.createElement('canvas');
const staticCtx = staticCanvas.getContext('2d');
let L = { padL: 64, padT: 28, padR: 14, padB: 8, minStep: 0, maxStep: 12, rowH: 18, w: 0, h: 0, percH: 22, hasPerc: false };

function layoutRoll() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const narrow = window.innerWidth < 720;
  const steps0 = piece ? piece.notes.filter(n => n.step != null).map(n => n.step) : [0, 12];
  let lo0 = Math.min(...steps0), hi0 = Math.max(...steps0);
  if (hi0 - lo0 < 8) { lo0 = Math.floor(lo0 - 2); hi0 = lo0 + 9; }
  const rowCount = hi0 - lo0 + 1;
  const hasPerc0 = !!(piece && piece.notes.some(n => n.step == null));
  const minRow = narrow ? 13 : 19;
  const target = Math.max(narrow ? 250 : 310, Math.min(narrow ? 400 : 500,
    L.padT + L.padB + (hasPerc0 ? 24 : 0) + rowCount * minRow));
  if (roll.parentElement) roll.parentElement.style.height = target + 'px';
  const w = roll.clientWidth, h = roll.clientHeight;
  roll.width = Math.floor(w * dpr); roll.height = Math.floor(h * dpr);
  rollCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  staticCanvas.width = Math.floor(w * dpr); staticCanvas.height = Math.floor(h * dpr);
  staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.w = w; L.h = h;
  const steps = piece ? piece.notes.filter(n => n.step != null).map(n => n.step) : [0, 12];
  let lo = Math.min(...steps), hi = Math.max(...steps);
  if (hi - lo < 8) { lo = Math.floor(lo - 2); hi = lo + 9; }
  L.minStep = lo; L.maxStep = hi;
  L.hasPerc = !!(piece && piece.notes.some(n => n.step == null));
  L.percH = L.hasPerc ? 24 : 0;
  const rows = hi - lo + 1;
  L.rowH = Math.max(10, (h - L.padT - L.padB - L.percH) / rows);
  lastPainted = -1;
}

const xForBeat = beat => L.padL + (beat / Math.max(1, piece.meta.beats)) * (L.w - L.padL - L.padR);
const yForStep = step => L.padT + (L.maxStep - step) * L.rowH;

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawStatic() {
  const ctx = staticCtx;
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, L.w, L.h);
  // 左侧音级栏
  ctx.fillStyle = 'rgba(5, 7, 10, .72)';
  ctx.fillRect(0, 0, L.padL, L.h);
  if (!piece) return;
  const totalBeats = piece.meta.beats;

  // 段落底纹
  piece.sections.forEach((s, i) => {
    const x0 = xForBeat(s.startBeat), x1 = xForBeat(s.startBeat + s.bars * 4);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.016)' : 'rgba(255,255,255,.005)';
    ctx.fillRect(x0, L.padT - 12, x1 - x0, L.h - L.padT - L.padB);
    ctx.fillStyle = 'rgba(238,203,141,.92)';
    ctx.font = '11.5px "Songti SC", "PingFang SC", serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, x0 + 7, L.padT - 5);
    ctx.strokeStyle = 'rgba(217,164,65,.18)';
    ctx.beginPath(); ctx.moveTo(x0, L.padT - 11); ctx.lineTo(x0 + 22, L.padT - 11); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.moveTo(x1, L.padT - 12); ctx.lineTo(x1, L.h - L.padB); ctx.stroke();
  });

  // 音级横线
  const sparse = L.w < 620;
  for (let s = L.minStep; s <= L.maxStep; s++) {
    const y = yForStep(s);
    const d = stepDegree(s);
    ctx.strokeStyle = d === 0 ? 'rgba(217,164,65,.22)' : 'rgba(255,255,255,.045)';
    ctx.beginPath(); ctx.moveTo(L.padL, y + L.rowH / 2); ctx.lineTo(L.w - L.padR, y + L.rowH / 2); ctx.stroke();
    if (sparse && d !== 0) continue;
    ctx.fillStyle = d === 0 ? 'rgba(238,203,141,.95)' : 'rgba(255,255,255,.52)';
    ctx.font = `${d === 0 ? 11.5 : 10.5}px "Songti SC", serif`;
    ctx.textAlign = 'right';
    ctx.fillText(DEGREES[d], L.padL - 12, y + L.rowH / 2 + 3.4);
    if (stepOctave(s) > 0) {
      ctx.beginPath();
      ctx.arc(L.padL - 8, y + L.rowH / 2 - 3.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 拍线
  for (let b = 0; b <= totalBeats; b++) {
    const x = xForBeat(b);
    const bar = b % 4 === 0;
    ctx.strokeStyle = bar ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.moveTo(x, L.padT - 12); ctx.lineTo(x, L.h - L.padB); ctx.stroke();
    if (bar) {
      ctx.fillStyle = 'rgba(255,255,255,.30)';
      ctx.font = '9.5px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(String(b / 4 + 1), x + 3, L.h - 4);
    }
  }

  // 音符
  const noteH = Math.max(5, L.rowH * 0.56);
  for (const n of piece.notes) {
    const col = piece.trackDefs[n.track]?.color || '#d9a441';
    if (n.step == null) {
      const x = xForBeat(n.t);
      const y = L.h - L.padB - L.percH + 4;
      const w = Math.max(3, xForBeat(n.t + 0.4) - x);
      ctx.fillStyle = hexA(col, 0.35 + n.vel * 0.55);
      roundRect(ctx, x, y, w, L.percH - 8, 3); ctx.fill();
      continue;
    }
    const x = xForBeat(n.t);
    const w = Math.max(2.5, xForBeat(n.t + n.dur) - x - 1.2);
    const y = yForStep(n.step) + (L.rowH - noteH) / 2;
    ctx.fillStyle = hexA(col, 0.30 + n.vel * 0.62);
    roundRect(ctx, x, y, w, noteH, Math.min(4, noteH / 2)); ctx.fill();
    if (n.track === 'lead' && w > 14) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(x + 2, y + noteH - 2, w - 4, 1);
    }
  }
  // 打击轨底
  if (L.hasPerc) {
    const y = L.h - L.padB - L.percH;
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.beginPath(); ctx.moveTo(L.padL, y); ctx.lineTo(L.w - L.padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.font = '9.5px "PingFang SC", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('打击', L.padL - 8, y + 14);
  }
  // 左侧竖线
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.moveTo(L.padL, 0); ctx.lineTo(L.padL, L.h); ctx.stroke();
}

function paint() {
  if (!L.w) return;
  rollCtx.clearRect(0, 0, L.w, L.h);
  rollCtx.drawImage(staticCanvas, 0, 0, L.w, L.h);
  if (!piece) return;
  const pos = player.position;
  const beat = pos / (60 / piece.meta.bpm);
  const x = xForBeat(beat);
  if (beat >= 0) {
    const grad = rollCtx.createLinearGradient(x - 14, 0, x + 14, 0);
    grad.addColorStop(0, 'rgba(217,164,65,0)');
    grad.addColorStop(0.5, 'rgba(217,164,65,.16)');
    grad.addColorStop(1, 'rgba(217,164,65,0)');
    rollCtx.fillStyle = grad;
    rollCtx.fillRect(x - 14, L.padT - 12, 28, L.h - L.padT - L.padB);
    rollCtx.save();
    rollCtx.shadowColor = 'rgba(240,205,140,.65)';
    rollCtx.shadowBlur = 8;
    rollCtx.strokeStyle = 'rgba(248,220,164,.98)';
    rollCtx.lineWidth = 1.6;
    rollCtx.beginPath(); rollCtx.moveTo(x, L.padT - 12); rollCtx.lineTo(x, L.h - L.padB); rollCtx.stroke();
    rollCtx.restore();
    rollCtx.fillStyle = 'rgba(248,220,164,.95)';
    rollCtx.beginPath();
    rollCtx.moveTo(x - 5, L.padT - 21); rollCtx.lineTo(x + 5, L.padT - 21); rollCtx.lineTo(x, L.padT - 12);
    rollCtx.closePath(); rollCtx.fill();
    rollCtx.lineWidth = 1;
  }
  if (hoverNote) {
    const n = hoverNote;
    const hx = xForBeat(n.t), hw = Math.max(2.5, xForBeat(n.t + n.dur) - hx - 1.2);
    if (n.step != null) {
      const y = yForStep(n.step) + (L.rowH - L.rowH * 0.56) / 2;
      rollCtx.strokeStyle = 'rgba(255,255,255,.55)';
      roundRect(rollCtx, hx, y, hw, L.rowH * 0.56, 3); rollCtx.stroke();
    }
  }
}

function rollSeek(clientX) {
  if (!piece) return;
  const rect = roll.getBoundingClientRect();
  const beat = ((clientX - rect.left - L.padL) / (L.w - L.padL - L.padR)) * piece.meta.beats;
  const t = Math.max(0, Math.min(piece.meta.beats, beat)) * (60 / piece.meta.bpm);
  player.seek(t);
  $('tNow').textContent = fmt(t);
  paint();
}

function hitTest(clientX, clientY) {
  if (!piece) return null;
  const rect = roll.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  for (const n of piece.notes) {
    if (n.step == null) continue;
    const nx = xForBeat(n.t), nw = Math.max(3, xForBeat(n.t + n.dur) - nx);
    const ny = yForStep(n.step), nh = L.rowH;
    if (x >= nx - 2 && x <= nx + nw + 2 && y >= ny && y <= ny + nh) return n;
  }
  return null;
}

/* ---------------- 播放控制 ---------------- */
async function togglePlay() {
  if (!piece) { await generate(); if (!piece) return; }
  if (player.playing) {
    player.pause();
    $('btnPlay').textContent = '▶'; $('btnPlay').classList.remove('playing');
  } else {
    await player.play();
    $('btnPlay').textContent = '❚❚'; $('btnPlay').classList.add('playing');
  }
}

function stopAll() {
  player.stop();
  $('btnPlay').textContent = '▶'; $('btnPlay').classList.remove('playing');
  $('tNow').textContent = '0:00';
  paint();
}

function tick() {
  if (player.playing) {
    const p = player.position;
    $('tNow').textContent = fmt(p);
    if (Math.abs(p - lastPainted) > 0.008) { paint(); lastPainted = p; }
  }
  requestAnimationFrame(tick);
}

/* ---------------- 导出 ---------------- */
async function exportWav() {
  if (!piece) return toast('先生成一首曲子');
  const btn = $('btnWav');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '渲染中…';
  try {
    const buf = await player.renderOffline(piece, { mute: player.mute, solo: player.solo, gains: player.gains });
    const ab = audioBufferToWav(buf);
    const name = `${sanitize(piece.meta.title)}_${piece.meta.key}${piece.meta.modeName}_${piece.meta.bpm}bpm.wav`;
    downloadBlob(new Blob([ab], { type: 'audio/wav' }), name);
    toast(`已导出 ${name} · ${(ab.byteLength / 1048576).toFixed(1)} MB · 44.1kHz/16bit`, 3600);
  } catch (e) {
    console.error(e); toast('导出失败：' + e.message, 4000);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function exportMidi() {
  if (!piece) return toast('先生成一首曲子');
  const name = `${sanitize(piece.meta.title)}_${piece.meta.key}${piece.meta.modeName}.mid`;
  downloadMidi(piece, name);
  toast(`已导出 ${name} · 可直接拖进 DAW 换音色`, 3200);
}

/* ---------------- 作品库 ---------------- */
function savePiece() {
  if (!piece) return toast('还没有作品');
  const list = library();
  const id = 'w' + Date.now();
  list.unshift({ id, at: Date.now(), piece });
  setLibrary(list);
  renderLibrary();
  toast(`已保存《${piece.meta.title}》`);
}

function renderLibrary() {
  const list = library();
  $('libCount').textContent = list.length ? `${list.length} 首` : '空';
  const ul = $('lib');
  if (!list.length) { ul.innerHTML = '<li class="empty">还没有保存的作品</li>'; return; }
  ul.innerHTML = list.map(it => `
    <li data-id="${it.id}">
      <div><div class="t">${it.piece.meta.title}</div>
      <div class="s">${it.piece.meta.key} ${it.piece.meta.modeName} · ${it.piece.meta.bpm}BPM · ${fmt(it.piece.meta.duration)}</div></div>
      <div class="ops"><button data-op="load">载入</button><button data-op="del">删</button></div>
    </li>`).join('');
  ul.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async e => {
      const op = e.target.dataset.op;
      if (!op) return;
      const list2 = library();
      const item = list2.find(x => x.id === li.dataset.id);
      if (!item) return;
      if (op === 'load') {
        await player.build(item.piece);
        player.stop();
        setPiece(item.piece);
        toast(`已载入《${item.piece.meta.title}》`);
      } else {
        setLibrary(list2.filter(x => x.id !== li.dataset.id));
        renderLibrary();
      }
    });
  });
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $('inspire').addEventListener('input', e => { settings.inspire = e.target.value; saveSettings(); });
  $('moodChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    settings.mood = b.dataset.mood;
    const m = MOOD_BY_ID[settings.mood];
    settings.bpm = m.bpm; settings.density = Math.round(m.density * 100);
    $('bpm').value = settings.bpm; $('bpmVal').textContent = settings.bpm;
    $('density').value = settings.density; $('densityVal').textContent = settings.density + '%';
    syncUI(); saveSettings();
    generate();
  });
  $('bpm').addEventListener('input', e => { settings.bpm = +e.target.value; $('bpmVal').textContent = settings.bpm; saveSettings(); });
  $('density').addEventListener('input', e => { settings.density = +e.target.value; $('densityVal').textContent = settings.density + '%'; saveSettings(); });
  $('mode').addEventListener('change', e => { settings.mode = +e.target.value; saveSettings(); });
  $('key').addEventListener('change', e => { settings.key = e.target.value; saveSettings(); buildKeys(); });
  $('length').addEventListener('change', e => { settings.length = e.target.value; saveSettings(); });
  $('seed').addEventListener('input', e => { settings.seed = e.target.value; saveSettings(); });
  $('dice').addEventListener('click', () => {
    settings.seed = String(Math.floor(Math.random() * 999999));
    $('seed').value = settings.seed; saveSettings();
  });
  $('btnGenerate').addEventListener('click', () => generate());
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnStop').addEventListener('click', stopAll);
  $('btnLoop').addEventListener('click', () => {
    player.loop = !player.loop;
    $('btnLoop').classList.toggle('on', player.loop);
  });
  $('btnWav').addEventListener('click', exportWav);
  $('btnMidi').addEventListener('click', exportMidi);
  $('btnSave').addEventListener('click', savePiece);
  $('btnTheory').addEventListener('click', () => $('theoryModal').hidden = false);
  $('closeTheory').addEventListener('click', () => $('theoryModal').hidden = true);
  $('theoryModal').addEventListener('click', e => { if (e.target.id === 'theoryModal') $('theoryModal').hidden = true; });
  $('btnShare').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + '#' + new URLSearchParams({
      seed: settings.seed || (piece ? piece.meta.seed : ''), mood: settings.mood, mode: settings.mode,
      key: settings.key, bpm: settings.bpm, density: settings.density, len: settings.length,
    }).toString();
    try { await navigator.clipboard.writeText(url); toast('链接已复制 · 打开即还原这首曲子'); }
    catch (e) { toast(url, 6000); }
  });

  $('timbreList').addEventListener('click', async e => {
    const b = e.target.closest('.timbre'); if (!b) return;
    const id = b.dataset.inst;
    try {
      await player.ensure();
      const buf = renderDemo(id, currentRoot(), new Rng(Math.random() * 1e9));
      const ab = player.ctx.createBuffer(1, buf.length, 44100);
      ab.copyToChannel(buf, 0);
      const src = player.ctx.createBufferSource(); src.buffer = ab;
      const g = player.ctx.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(player.master); src.start();
      toast(`试听：${INSTRUMENTS[id].name} · 五声上行`);
    } catch (err) { toast('试听失败：' + err.message); }
  });

  $('octUp').addEventListener('click', () => { keyOctave = Math.min(2, keyOctave + 1); buildKeys(); });
  $('octDown').addEventListener('click', () => { keyOctave = Math.max(0, keyOctave - 1); buildKeys(); });

  roll.addEventListener('click', e => rollSeek(e.clientX));
  roll.addEventListener('mousemove', e => {
    const n = hitTest(e.clientX, e.clientY);
    const tip = $('rollTip');
    if (n && n.step != null) {
      hoverNote = n;
      const rect = roll.getBoundingClientRect();
      tip.style.left = (e.clientX - rect.left) + 'px';
      tip.style.top = (e.clientY - rect.top) + 'px';
      tip.textContent = `${stepName(n.step)} · 简谱 ${JIANPU[stepDegree(n.step)]} · ${n.t.toFixed(2)} 拍 · 力度 ${Math.round(n.vel * 100)}`;
      tip.style.opacity = '1';
    } else {
      hoverNote = null; tip.style.opacity = '0';
    }
    if (!player.playing) paint();
  });
  roll.addEventListener('mouseleave', () => { hoverNote = null; $('rollTip').style.opacity = '0'; if (!player.playing) paint(); });

  player.onended = () => { $('btnPlay').textContent = '▶'; $('btnPlay').classList.remove('playing'); };

  window.addEventListener('resize', () => {
    if (!piece) return;
    layoutRoll(); drawStatic(); paint();
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); generate(); return; }
    if (e.key === 'z' || e.key === 'Z') { keyOctave = Math.max(0, keyOctave - 1); buildKeys(); return; }
    if (e.key === 'x' || e.key === 'X') { keyOctave = Math.min(2, keyOctave + 1); buildKeys(); return; }
    const idx = KEYMAP[e.key.toLowerCase()];
    if (idx != null) {
      const base = (keyOctave - 1) * 5;
      const elm = document.querySelectorAll('.key')[idx];
      playPad(base + idx, elm);
    }
  });
}

/* ---------------- 启动 ---------------- */
function applyHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  const p = new URLSearchParams(hash);
  if (!p.get('mood')) return false;
  settings.mood = p.get('mood') || settings.mood;
  settings.mode = Number(p.get('mode') ?? settings.mode);
  settings.key = p.get('key') || settings.key;
  settings.bpm = Number(p.get('bpm') ?? settings.bpm);
  settings.density = Number(p.get('density') ?? settings.density);
  settings.length = p.get('len') || settings.length;
  settings.seed = p.get('seed') || '';
  syncUI();
  return true;
}

async function main() {
  initControls();
  bind();
  buildKeys();
  renderLibrary();
  tick();
  const fromHash = applyHash();
  if (fromHash) {
    await generate(true);
  }
}

window.__ws = { player, get piece() { return piece; }, get settings() { return settings; } };
main();
