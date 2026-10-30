// 五声工坊 · 交互层
import { Player } from './player.js';
import { compose, defaultTracks, ROLE_IDS, TRANSITIONS, ARCS } from './composer.js';
import {
  TEXTURES, HARMONY_STYLES, BANSHI, ORNAMENT_LEVELS, DYNAMICS, SPACES, FORMS, JOINTS,
  PARAM_DOC, BAYIN,
} from './techniques.js';
import { audioBufferToWav, downloadBlob } from './wav.js';
import { downloadMidi } from './midi.js';
import { INSTRUMENTS, renderDemo, renderAmbience } from './synth.js';
import { Rng } from './rng.js';
import {
  MOODS, MOOD_BY_ID, MODES, KEYS, DEGREES, JIANPU, analyzeInspiration,
  stepToMidi, midiToFreq, stepDegree, stepOctave, stepName,
} from './theory.js';

const $ = id => document.getElementById(id);
const player = new Player();
const API = 'api/arrange';

const DEFAULTS = {
  inspire: '', mood: 'qingya', mode: 0, key: 'C', bpm: 68, density: 55,
  bars: 20, seed: '', ai: true, loop: false, tracks: null, title: '', reason: '',
  texture: 'heterophony', harmony: 'open5', form: 'qichengzhuanhe', joint: 'yuyaowei',
  ornament: 'some', dynamics: 'natural', banship: 'tempoCurve', space: 'hall',
  locks: {},
  segments: null,      // null = 单段（用全局参数）
  segBars: 24,
  segTransition: 'bridge',
};

let settings = loadSettings();
let piece = null;
let seedNum = null;
let keyOctave = 1;
let hoverNote = null;
let lastPainted = -1;
let volume = {};
let busy = false;
let recomposeTimer = null;
let seedSource = 'auto'; // auto | user

/* ---------------- 持久化 ---------------- */
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ws.settings.v2') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('ws.settings.v2', JSON.stringify(settings)); } catch { }
}
const library = () => { try { return JSON.parse(localStorage.getItem('ws.library.v1') || '[]'); } catch { return []; } };
function setLibrary(list) {
  try { localStorage.setItem('ws.library.v1', JSON.stringify(list.slice(0, 24))); }
  catch { toast('本地存储已满，先删几首旧作品'); }
}

/* ---------------- 小工具 ---------------- */
function fmt(sec) {
  sec = Math.max(0, sec || 0);
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
const sanitizeName = s => (s || 'untitled').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
let toastTimer = null;
function toast(msg, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function status(msg, kind = '') {
  const el = $('genStatus');
  el.textContent = msg || '';
  el.className = 'gen-status' + (kind ? ' ' + kind : '');
}
const hexA = (hex, a) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
/* ---------------- 生成进度弹窗 ---------------- */
const GEN_PHASES = {
  ai: '理解灵感',
  compose: '编写乐曲',
  synth: '合成音色',
  mix: '混音导出',
};
const RING_LEN = 326.7;
let genState = { open: false, startedAt: 0, value: 0, cancelled: false };

function openGen(title = '正在编曲') {
  const el = $('genOverlay');
  if (!el) return;
  genState = { open: true, startedAt: Date.now(), value: 0, cancelled: false };
  $('genTitle').textContent = title;
  $('genPhase').textContent = '准备中…';
  $('genMeta').textContent = '';
  $('genPct').innerHTML = '0<i>%</i>';
  $('genRing').style.strokeDashoffset = RING_LEN;
  $('genBar').style.width = '0%';
  el.hidden = false;
}
function setGen(value, phase, meta) {
  if (!genState.open) return;
  const v = Math.max(genState.value, Math.min(1, value || 0)); // 只前进不后退
  genState.value = v;
  const pct = Math.round(v * 100);
  $('genPct').innerHTML = pct + '<i>%</i>';
  $('genRing').style.strokeDashoffset = RING_LEN * (1 - v);
  $('genRing').style.stroke = v >= 1 ? '#5fc9a8' : '#d9a441';
  $('genBar').style.width = (v * 100) + '%';
  if (phase) $('genPhase').textContent = phase;
  if (meta !== undefined) $('genMeta').textContent = meta;
}
function closeGen() {
  if (!genState.open) return;
  genState.open = false;
  const el = $('genOverlay');
  if (el) el.hidden = true;
  // 弹窗关闭后，侧栏那条细进度条也一并收起
  const bar = $('genProgress')?.firstElementChild;
  if (bar) setTimeout(() => { bar.style.width = '0'; }, 120);
}

const debounce = (fn, ms) => (...args) => { clearTimeout(recomposeTimer); recomposeTimer = setTimeout(() => fn(...args), ms); };

/* ---------------- 控件初始化 ---------------- */
const PITCHED = ['guzheng', 'erhu', 'pipa', 'guqin', 'dizi', 'xiao', 'suona', 'xun', 'bianzhong', 'yangqin', 'pad'];
const PERC_OPTS = ['drum', 'muyu', 'gong', 'bianzhong'];
const AMB_OPTS = ['rain', 'wind'];
const BASS_OPTS = ['bass', 'guqin', 'pad', 'xun'];
const PAD_OPTS = ['pad', 'xiao', 'erhu', 'dizi', 'xun', 'suona'];
function optionsFor(role) {
  if (role === 'amb') return AMB_OPTS;
  if (role === 'perc') return PERC_OPTS;
  if (role === 'bass') return BASS_OPTS;
  if (role === 'pad') return PAD_OPTS;
  return PITCHED;
}

function initControls() {
  $('mode').innerHTML = MODES.map((m, i) => `<option value="${i}">${m.name}</option>`).join('');
  $('key').innerHTML = KEYS.map(k => `<option value="${k.name}">${k.name} 为主音</option>`).join('');
  const fill = (id, map, key = 'name') => {
    $(id).innerHTML = Object.values(map)
      .map(v => `<option value="${v.id}">${v[key]}</option>`)
      .join('');
  };
  fill('texture', TEXTURES);
  fill('harmony', HARMONY_STYLES);
  fill('form', FORMS);
  fill('joint', JOINTS);
  fill('ornament', ORNAMENT_LEVELS);
  fill('dynamics', DYNAMICS);
  fill('banship', BANSHI);
  fill('space', SPACES);

  $('moodChips').innerHTML = MOODS.map(m =>
    `<button class="chip" data-mood="${m.id}" title="${m.desc}">${m.name}</button>`).join('');
  $('segTransition').innerHTML = Object.values(TRANSITIONS)
    .map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  renderTimbres();
  renderSegs();
  syncUI();
}

let pendingDirty = false;
function flagPending() {
  pendingDirty = true;
  const btn = $('btnGenerate');
  btn.classList.add('pending');
  const label = btn.querySelector('span');
  if (label) label.textContent = '应用修改';
  $('paramHint').textContent = '已修改，点左侧按钮生效';
  $('paramHint').classList.add('dirty');
}
function clearPending() {
  pendingDirty = false;
  const btn = $('btnGenerate');
  btn.classList.remove('pending');
  const label = btn.querySelector('span');
  if (label) label.textContent = '生成编曲';
  $('paramHint').textContent = '改动需重新生成';
  $('paramHint').classList.remove('dirty');
}

function renderTimbres() {
  const groups = [
    { name: '丝 · 弹拨', ids: ['guzheng', 'guqin', 'pipa', 'liuqin', 'yueqin', 'sanxian', 'ruan', 'konghou', 'yangqin'] },
    { name: '丝 · 拉弦', ids: ['erhu', 'jinghu', 'banhu'] },
    { name: '竹匏土 · 吹管', ids: ['dizi', 'xiao', 'xun', 'sheng', 'suona', 'guanzi', 'hulusi', 'bawu', 'ocarina'] },
    { name: '金石 · 钟磬', ids: ['bianzhong', 'bianqing', 'gong', 'pengling'] },
    { name: '革木 · 打击', ids: ['drum', 'paigu', 'muyu', 'bangzi'] },
    { name: '电子 · 铺底', ids: ['pad', 'bass'] },
    { name: '氛围', ids: ['rain', 'wind'] },
  ];
  $('timbreList').innerHTML = groups.map(g => {
    const items = g.ids.filter(id => INSTRUMENTS[id]).map(id => {
      const ins = INSTRUMENTS[id];
      return `<button class="timbre" data-inst="${id}" style="--c:${ins.color}" title="${ins.name} · ${ins.desc}">
        <span class="dotc"></span><span class="nm">${ins.name}</span><span class="play">▶</span>
      </button>`;
    }).join('');
    return items ? `<div class="timbre-group"><h4>${g.name}</h4><div class="timbre-strip">${items}</div></div>` : '';
  }).join('');
  const total = Object.keys(INSTRUMENTS).length;
  $('timbreCount').textContent = `点击试听 · 共 ${total} 种`;
}

function syncUI() {
  $('inspire').value = settings.inspire;
  $('mode').value = String(settings.mode);
  $('key').value = settings.key;
  $('bpm').value = settings.bpm; $('bpmVal').textContent = settings.bpm;
  $('density').value = settings.density; $('densityVal').textContent = settings.density + '%';
  $('bars').value = settings.bars;
  $('barsVal').textContent = settings.bars;
  $('durHint').textContent = `≈ ${fmt(settings.bars * 240 / settings.bpm)}`;
  $('seed').value = settings.seed;
  if ($('segBars')) { $('segBars').value = settings.segBars || 24; $('segBarsVal').textContent = settings.segBars || 24; }
  $('aiToggle').checked = !!settings.ai;
  $('loopToggle').checked = !!settings.loop;
  $('texture').value = settings.texture;
  $('harmony').value = settings.harmony;
  $('form').value = settings.form;
  $('joint').value = settings.joint;
  $('ornament').value = settings.ornament;
  $('dynamics').value = settings.dynamics;
  $('banship').value = settings.banship;
  $('space').value = settings.space;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.mood === settings.mood));
}

/* ---------------- 段落结构 ---------------- */
function segsOf() {
  if (!Array.isArray(settings.segments) || !settings.segments.length) {
    // 从当前全局设置派生一个单段
    return [{
      mood: settings.mood, bars: settings.segBars || 24,
      mode: settings.mode, bpm: settings.bpm, density: settings.density,
      texture: settings.texture, harmony: settings.harmony,
      ornament: settings.ornament, dynamics: settings.dynamics,
      transitionIn: 'cut', label: MOOD_BY_ID[settings.mood]?.name || '主段',
    }];
  }
  return settings.segments;
}
function setSegs(list) {
  settings.segments = list.length ? list : null;
  saveSettings();
  renderSegs();
  if (piece) flagPending();
}
function renderSegs() {
  const list = segsOf();
  const isMulti = !!(settings.segments && settings.segments.length);
  $('segList').innerHTML = list.map((sg, i) => {
    const mood = MOOD_BY_ID[sg.mood] || MOOD_BY_ID.qingya;
    const moods = MOODS.map(m => `<option value="${m.id}" ${m.id === sg.mood ? 'selected' : ''}>${m.name}</option>`).join('');
    return `<div class="seg-row" data-idx="${i}" style="--c:${mood.color}">
      <span class="swatch"></span>
      <select class="seg-mood" data-idx="${i}">${moods}</select>
      <input class="bars-in" data-idx="${i}" type="number" min="2" max="48" value="${sg.bars || ''}" placeholder="自动" title="小节数">
      <select class="seg-trans" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>
        ${Object.values(TRANSITIONS).map(t => `<option value="${t.id}" ${(sg.transitionIn || 'cut') === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
      </select>
      <div class="ops">
        <button class="up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button class="del" data-idx="${i}" ${list.length <= 1 ? 'disabled' : ''} title="删除">×</button>
      </div>
    </div>`;
  }).join('');

  $('segList').querySelectorAll('.seg-mood').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.idx, list2 = segsOf();
      list2[i] = { ...list2[i], mood: el.value, label: MOOD_BY_ID[el.value]?.name };
      // 换情绪时同步该段的默认速度与配器
      const m = MOOD_BY_ID[el.value];
      if (m) { list2[i].bpm = m.bpm; list2[i].density = Math.round(m.density * 100); }
      setSegs(list2);
    });
  });
  $('segList').querySelectorAll('.bars-in').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.idx, list2 = segsOf();
      list2[i] = { ...list2[i], bars: Number(el.value) || null };
      setSegs(list2);
    });
  });
  $('segList').querySelectorAll('.seg-trans').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.idx, list2 = segsOf();
      list2[i] = { ...list2[i], transitionIn: el.value };
      setSegs(list2);
    });
  });
  $('segList').querySelectorAll('.up').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.idx; if (i === 0) return;
      const list2 = segsOf();
      [list2[i - 1], list2[i]] = [list2[i], list2[i - 1]];
      setSegs(list2);
    });
  });
  $('segList').querySelectorAll('.del').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.idx, list2 = segsOf();
      if (list2.length <= 1) return;
      list2.splice(i, 1);
      setSegs(list2);
    });
  });
  $('segBars').value = settings.segBars;
  $('segBarsVal').textContent = settings.segBars;
  $('segTransition').value = settings.segTransition;
}

/* ---------------- 参数锁 ---------------- */
const LOCKABLE = ['mode', 'key', 'texture', 'harmony', 'form', 'joint', 'ornament',
  'dynamics', 'banship', 'space', 'bpm', 'density', 'bars', 'loop', 'seed', 'tracks', 'mood'];
const isLocked = k => !!(settings.locks && settings.locks[k]);
function toggleLock(k, force) {
  settings.locks = settings.locks || {};
  const next = force === undefined ? !settings.locks[k] : force;
  if (next) settings.locks[k] = true; else delete settings.locks[k];
  saveSettings();
  renderLocks();
}
function renderLocks() {
  document.querySelectorAll('.lk[data-lock]').forEach(el => {
    el.classList.toggle('on', isLocked(el.dataset.lock));
    el.title = isLocked(el.dataset.lock) ? '已锁定：重新生成时保持不变' : '点此锁定，重新生成时不变';
  });
  $('btnLockTracks').classList.toggle('on', isLocked('tracks'));
  const locked = LOCKABLE.filter(isLocked);
  const hint = $('lockHint');
  if (locked.length) {
    const label = { mode: '调式', key: '主音', texture: '织体', harmony: '和声', form: '曲式',
      joint: '句法', ornament: '装饰', dynamics: '力度', banship: '速度走向', space: '空间',
      bpm: '速度', density: '密度', bars: '长度', loop: '循环', seed: '种子',
      tracks: '配器', mood: '曲风' };
    hint.hidden = false;
    const names = locked.map(k => label[k] || k);
    hint.textContent = names.length <= 3
      ? `已锁定 ${names.join('、')}，重新生成时保持`
      : `已锁定 ${names.length} 项（${names.slice(0, 3).join('、')} 等）`;
    hint.title = `锁定项：${names.join('、')}`;
  } else {
    hint.hidden = true;
  }
  // 视觉上让锁定的字段边框变色
  document.querySelectorAll('.field').forEach(f => {
    const lk = f.querySelector('.lk[data-lock]');
    f.classList.toggle('locked-field', !!(lk && isLocked(lk.dataset.lock)));
  });
}
// 从一组候选里取「未被锁定」的字段，锁定的用当前值
function pick(field, candidate) {
  return isLocked(field) ? settings[field] : candidate;
}

/* ---------------- 五声键盘 ---------------- */
const KEYMAP = { a: 0, s: 1, d: 2, f: 3, g: 4, q: 5, w: 6, e: 7, r: 8, t: 9 };
const currentRoot = () => (piece ? piece.meta.rootMidi : (KEYS.find(k => k.name === settings.key) || KEYS[0]).midi);
const leadInst = () => piece?.tracks.find(t => t.role === 'lead')?.inst || 'guzheng';

function buildKeys() {
  const base = (keyOctave - 1) * 5;
  $('octLabel').textContent = ['低音区', '中音区', '高音区'][keyOctave];
  const hint = ['A', 'S', 'D', 'F', 'G', 'Q', 'W', 'E', 'R', 'T'];
  let html = '';
  for (let i = 0; i < 10; i++) {
    const step = base + i, d = stepDegree(step);
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
  if (elm) { elm.classList.add('active'); setTimeout(() => elm.classList.remove('active'), 170); }
  try { await player.trigger(leadInst(), midiToFreq(midi), 0.95, 0.9); }
  catch { toast('音频启动失败，点一下页面再试'); }
}

/* ---------------- 大模型 ---------------- */
async function callArrange(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22000);
  try {
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }), signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'AI 超时' : e.message };
  } finally { clearTimeout(timer); }
}

/* ---------------- 生成 / 重排 ---------------- */
function readForm() {
  settings.inspire = $('inspire').value.trim();
  settings.mode = +$('mode').value;
  settings.key = $('key').value;
  settings.bpm = +$('bpm').value;
  settings.density = +$('density').value;
  settings.bars = +$('bars').value;
  settings.seed = $('seed').value.trim();
  settings.ai = $('aiToggle').checked;
  settings.texture = $('texture').value;
  settings.harmony = $('harmony').value;
  settings.form = $('form').value;
  settings.joint = $('joint').value;
  settings.ornament = $('ornament').value;
  settings.dynamics = $('dynamics').value;
  settings.banship = $('banship').value;
  settings.space = $('space').value;
  return settings;
}

async function generate() {
  if (busy) return;
  const s = readForm();
  const btn = $('btnGenerate');
  btn.disabled = true; busy = true;
  const bar = $('genProgress').firstElementChild;
  bar.style.width = '6%';
  let ai = null;

  try {
    openGen('正在编曲');
    setGen(0.02, '准备中…');
    if (s.ai && s.inspire.length >= 2) {
      status('AI 正在理解这段描述…');
      setGen(0.06, 'AI 正在理解这段描述…', '大模型选调式、速度与配器');
      bar.style.width = '18%';
      const res = await callArrange(s.inspire);
      if (res.ok && res.data) {
        ai = res.data;
        // 多段组曲：AI 直接给段落结构
        if (ai.segmented && Array.isArray(ai.segments)) {
          settings.segments = ai.segments.map((sg, i) => ({
            mood: sg.mood,
            bars: sg.bars,
            bpm: sg.bpm,
            mode: sg.mode,
            density: sg.density != null ? Math.round(sg.density * 100) : undefined,
            texture: sg.texture, harmony: sg.harmony,
            ornament: sg.ornament, dynamics: sg.dynamics,
            tracks: sg.tracks,
            transitionIn: i === 0 ? 'cut' : (sg.transitionIn || 'bridge'),
            label: sg.label || MOOD_BY_ID[sg.mood]?.name || sg.mood,
          }));
          if (ai.key) settings.key = pick('key', ai.key);
          settings.segBars = ai.segments.reduce((a, sg) => a + (sg.bars || 8), 0);
          settings.title = ai.title;
          settings.reason = ai.reason;
          renderSegs();
          syncUI();
          status(`AI 排了 ${ai.segments.length} 段：${ai.segments.map(sg => sg.label || sg.mood).join(' → ')}`, 'ok');
          seedNum = Math.floor(Math.random() * 1e9);
          settings.seed = String(seedNum);
          await buildPiece({ seed: seedNum, engine: 'llm', title: ai.title, reason: ai.reason });
          clearPending();
          closeGen();
          return;
        }
        // 锁定的字段一律保留当前值，不被 AI 覆盖
        settings.mood = pick('mood', ai.mood);
        settings.mode = pick('mode', ai.mode);
        settings.key = pick('key', ai.key);
        settings.bpm = pick('bpm', ai.bpm);
        settings.density = pick('density', Math.round(ai.density * 100));
        settings.bars = pick('bars', ai.bars);
        settings.tracks = isLocked('tracks')
          ? (settings.tracks?.length ? settings.tracks : defaultTracks(MOOD_BY_ID[settings.mood] || MOOD_BY_ID.qingya))
          : ai.tracks;
        settings.title = ai.title;
        settings.reason = ai.reason;
        for (const k of ['texture', 'harmony', 'form', 'joint', 'ornament', 'dynamics', 'space']) {
          if (ai[k]) settings[k] = pick(k, ai[k]);
        }
        if (typeof ai.loop === 'boolean') settings.loop = pick('loop', ai.loop);
        bar.style.width = '55%';
        setGen(0.3, '配器已确定', ai.tracks.map(t => INSTRUMENTS[t.inst]?.name || t.inst).join(' + '));
        status(`AI 已选：${ai.tracks.map(t => INSTRUMENTS[t.inst]?.name || t.inst).join(' + ')}`, 'ok');
      } else {
        status(`AI 未响应（${res.error || '未知'}），已用本地规则`, 'err');
      }
    }

    if (!ai) {
      const parsed = analyzeInspiration(s.inspire);
      if (parsed.mood) settings.mood = pick('mood', parsed.mood);
      if (parsed.mode != null && s.mode === 0) settings.mode = pick('mode', parsed.mode);
      if (parsed.key && s.key === 'C') settings.key = pick('key', parsed.key);
      if (!isLocked('tracks')) {
        settings.tracks = defaultTracks(MOOD_BY_ID[settings.mood] || MOOD_BY_ID.qingya);
      }
      settings.title = '';
      settings.reason = '';
      status(s.inspire ? '已按关键词解析' : '', '');
    }

    // 种子决策：
    //  - 锁定 → 沿用上次（配合其它锁可做「只换音色」）
    //  - 用户手填/点骰子 → 用他给的（可复现）
    //  - 系统上次自动掷的 → 本次重掷（这才是「重新生成」的默认语义）
    if (isLocked('seed') && seedNum != null) {
      // keep
    } else if (seedSource === 'user' && s.seed !== '') {
      seedNum = Number(s.seed);
    } else {
      seedNum = Math.floor(Math.random() * 1e9);
      seedSource = 'auto';
    }
    settings.seed = String(seedNum);
    syncUI();

    setGen(0.34, '编写乐曲…', `${settings.bars} 小节 · ${settings.bpm}BPM`);
    await new Promise(r => setTimeout(r, 16));

    await buildPiece({
      seed: seedNum, engine: ai ? 'llm' : 'rule',
      title: settings.title, reason: settings.reason,
      onProgress: (p, phase) => {
        bar.style.width = (55 + p * 45) + '%';
        const v = 0.34 + p * 0.66;
        if (phase === '合成') setGen(v, '合成音色…', '');
        else if (phase === '混音') setGen(v, '混音…', '');
        else if (phase) setGen(v, phase + '…', '');
        else setGen(v, '合成音色…', '');
      },
    });
    bar.style.width = '100%';
    setGen(1, '完成', `${piece.meta.bars} 小节 · ${fmt(piece.meta.duration)}`);
    await new Promise(r => setTimeout(r, 260));
    closeGen();
    clearPending();
    if (window.innerWidth < 1120) {
      setTimeout(() => document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
    if (!ai && settings.inspire) toast('已用本地规则生成');
  } catch (e) {
    console.error(e);
    closeGen();
    status('生成失败：' + e.message, 'err');
    toast('生成失败：' + e.message, 4000);
  } finally {
    // 无论成功失败，按钮都必须回到可用状态
    closeGen();
    btn.disabled = false;
    busy = false;
    btn.querySelector('span').textContent = '生成编曲';
    setTimeout(() => { bar.style.width = '0'; }, 700);
  }
}

async function buildPiece({ seed, engine, title, reason, onProgress, mood, mode, key, bpm, density, bars, loop, tracks }) {
  const use = {
    mood: mood ?? settings.mood,
    mode: mode ?? settings.mode,
    key: key ?? settings.key,
    bpm: bpm ?? settings.bpm,
    density: (density ?? settings.density) / 100,
    bars: bars ?? settings.bars,
    loop: loop ?? settings.loop,
    tracks: tracks ?? settings.tracks,
    texture: settings.texture, harmony: settings.harmony, form: settings.form,
    joint: settings.joint, ornament: settings.ornament, dynamics: settings.dynamics,
    banship: settings.banship, space: settings.space,
    segments: settings.segments && settings.segments.length > 1 ? settings.segments : null,
  };
  const p = compose({ ...use, seed, engine, title, reason });
  await player.build(p, onProgress);
  piece = p;
  // 多段模式下各段自带配器，不要把并集写回全局设置，否则下次单段生成会被污染
  if (!p.meta.segmented) settings.tracks = p.spec;
  player.loop = !!p.meta.loop;
  player.stop();
  player.mute.clear(); player.solo = null;
  volume = {};
  renderAll();
  applyVolumes();
  updateHash();
  saveSettings();
}

// tracksOnly：换乐器 / 加删轨道时用，沿用上次生成时的参数
const recompose = debounce(async (tracksOnly = false) => {
  if (!piece || busy) return;
  busy = true;
  openGen(tracksOnly ? '正在换配器' : '正在重排');
  setGen(0.05, tracksOnly ? '按新配器重排…' : '按新参数重排…');
  status(tracksOnly ? '换配器中…' : '重排中…');
  const m = piece.meta;
  const args = tracksOnly
    ? {
        mood: m.mood, mode: m.mode, key: m.key, bpm: m.bpm,
        density: Math.round(m.density * 100), bars: m.bars, loop: m.loop,
        tracks: settings.tracks,
      }
    : {
        mood: settings.mood, mode: settings.mode, key: settings.key, bpm: settings.bpm,
        density: settings.density, bars: settings.bars, loop: settings.loop,
        tracks: settings.tracks,
      };
  try {
    await buildPiece({
      ...args,
      seed: seedNum, engine: m.engine, title: m.title, reason: m.reason,
      onProgress: (p, phase) => setGen(0.05 + p * 0.95, phase === '合成' ? '合成音色…' : (phase ? phase + '…' : '合成音色…')),
    });
    setGen(1, '完成');
    await new Promise(r => setTimeout(r, 180));
    status(`已${tracksOnly ? '按新配器' : '按新参数'}重排 · ${piece.meta.bars} 小节 ${fmt(player.duration)}`);
  } catch (e) {
    status('重排失败：' + e.message, 'err');
  } finally {
    closeGen();
    busy = false;
  }
}, 420);

/* ---------------- 渲染 ---------------- */
function renderAll() {
  if (!piece) return;
  const m = piece.meta;
  $('title').textContent = m.title;
  $('desc').textContent = m.desc;
  const reason = $('reason');
  if (m.reason) { reason.hidden = false; reason.textContent = m.reason; } else reason.hidden = true;

  $('loopTag').hidden = !m.loop;
  $('btnLoop').classList.toggle('on', player.loop);
  $('btnLoop').textContent = player.loop ? '循环开' : '循环';

  const badge = $('engineBadge');
  badge.hidden = false;
  badge.textContent = m.engine === 'llm' ? 'AI 编曲' : '本地规则';
  badge.className = 'engine-badge' + (m.engine === 'llm' ? '' : ' rule');

  $('mTempo').textContent = m.bpm;
  $('mDur').textContent = fmt(m.duration);
  $('mBars').textContent = m.bars;
  $('mNotes').textContent = piece.notes.length;
  $('tTotal').textContent = fmt(m.duration);
  $('tNow').textContent = '0:00';
  $('rollEmpty').classList.add('hide');
  $('mixCount').textContent = `${piece.tracks.length} 轨`;
  renderMixer();
  buildKeys();
  layoutRoll(); drawStatic(); paint();
}

function renderMixer() {
  const wrap = $('mixer');
  wrap.innerHTML = piece.tracks.map(t => {
    const opts = optionsFor(t.role);
    const list = opts.includes(t.inst) ? opts : [t.inst, ...opts];
    return `<div class="mix-row ${t.isAmb ? 'amb' : ''}" data-track="${t.id}" style="--c:${t.color}">
      <span class="cbar"></span>
      <span class="rname">${t.name}</span>
      <select class="inst" data-id="${t.id}">
        ${list.map(i => `<option value="${i}" ${i === t.inst ? 'selected' : ''}>${INSTRUMENTS[i]?.name || i}</option>`).join('')}
      </select>
      <input type="range" class="vol" data-id="${t.id}" min="0" max="100" value="100" title="音量">
      <button class="mbtn mute" data-id="${t.id}" title="静音">M</button>
      <button class="mbtn solo" data-id="${t.id}" title="独奏">S</button>
      <button class="del" data-id="${t.id}" title="删除音轨">×</button>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.inst').forEach(sel => {
    sel.addEventListener('change', () => {
      const id = sel.dataset.id;
      const role = piece.tracks.find(p => p.id === id)?.role;
      if (!role) return;
      const idx = settings.tracks.findIndex(x => x.role === role);
      if (idx >= 0) settings.tracks[idx] = { role, inst: sel.value };
      recompose(true);
    });
  });
  wrap.querySelectorAll('.vol').forEach(r => {
    r.addEventListener('input', () => {
      volume[r.dataset.id] = +r.value / 100;
      applyVolumes();
    });
  });
  wrap.querySelectorAll('.mute').forEach(b => {
    b.addEventListener('click', () => {
      const on = !player.mute.has(b.dataset.id);
      player.setMute(b.dataset.id, on);
      b.classList.toggle('on', on);
    });
  });
  wrap.querySelectorAll('.solo').forEach(b => {
    b.addEventListener('click', () => {
      const on = player.solo !== b.dataset.id;
      player.setSolo(on ? b.dataset.id : null);
      wrap.querySelectorAll('.solo').forEach(x => x.classList.toggle('on', on && x === b));
    });
  });
  wrap.querySelectorAll('.del').forEach(b => {
    b.addEventListener('click', () => {
      const t = piece.tracks.find(p => p.id === b.dataset.id);
      if (!t) return;
      if (t.role === 'lead') { toast('主旋律不能删除，可以换音色'); return; }
      settings.tracks = settings.tracks.filter(x => x.role !== t.role);
      recompose(true);
    });
  });
  syncAddMenu();
}

function applyVolumes() {
  for (const t of piece?.tracks || []) {
    const v = volume[t.id] ?? 1;
    player.setTrackGain(t.id, (t.gain ?? 0.6) * v);
  }
}

const ROLE_QUOTA_UI = { harm: 2, pad: 2, bass: 1, perc: 1, amb: 1 };
function syncAddMenu() {
  const count = {};
  for (const t of piece?.tracks || []) count[t.role] = (count[t.role] || 0) + 1;
  const menu = $('addMenu');
  const label = { harm: '副旋律', pad: '铺底', bass: '低音', perc: '打击', amb: '氛围' };
  menu.innerHTML = ROLE_IDS.filter(r => r !== 'lead').map(r => {
    const full = (count[r] || 0) >= (ROLE_QUOTA_UI[r] || 1);
    return `<button data-role="${r}" ${full ? 'disabled' : ''}>${label[r]}${full ? ' · 已满' : ''}</button>`;
  }).join('');
  menu.querySelectorAll('button:not([disabled])').forEach(b => {
    b.addEventListener('click', () => {
      const role = b.dataset.role;
      const usedInst = new Set((settings.tracks || []).map(t => t.inst));
      const pool = optionsFor(role).filter(i => !usedInst.has(i));
      const inst = pool[0] || optionsFor(role)[0];
      settings.tracks = [...(settings.tracks || []), { role, inst }];
      menu.hidden = true;
      recompose(true);
    });
  });
}

/* ---------------- 卷帘 ---------------- */
const roll = $('roll');
const rollCtx = roll.getContext('2d');
const staticCanvas = document.createElement('canvas');
const staticCtx = staticCanvas.getContext('2d');
let L = { padL: 64, padT: 28, padR: 14, padB: 8, minStep: 0, maxStep: 12, rowH: 18, w: 0, h: 0, percH: 22, ambH: 0 };

function layoutRoll() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const narrow = window.innerWidth < 720;
  const steps = piece ? piece.notes.filter(n => n.step != null).map(n => n.step) : [0, 12];
  let lo = Math.min(...steps), hi = Math.max(...steps);
  if (hi - lo < 8) { lo = Math.floor(lo - 2); hi = lo + 9; }
  const rows = hi - lo + 1;
  L.hasPerc = !!(piece && piece.notes.some(n => n.step == null));
  L.percH = L.hasPerc ? 22 : 0;
  L.ambH = piece && piece.ambience?.length ? 12 : 0;
  const minRow = narrow ? 13 : 18;
  const target = Math.max(narrow ? 240 : 300, Math.min(narrow ? 400 : 520,
    L.padT + L.padB + L.percH + L.ambH + rows * minRow));
  if (roll.parentElement) roll.parentElement.style.height = target + 'px';

  const w = roll.clientWidth, h = roll.clientHeight;
  roll.width = Math.floor(w * dpr); roll.height = Math.floor(h * dpr);
  rollCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  staticCanvas.width = Math.floor(w * dpr); staticCanvas.height = Math.floor(h * dpr);
  staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.w = w; L.h = h; L.minStep = lo; L.maxStep = hi;
  L.rowH = Math.max(10, (h - L.padT - L.padB - L.percH - L.ambH) / rows);
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

// 多段模式下时间轴是「等效拍」，与真实小节号不成正比；
// 这里把等效拍换算回真实小节号，供刻度标注
function realBarAt(beat) {
  if (!piece?.meta?.segmented) return beat / 4;
  const secs = piece.sections || [];
  for (const s2 of secs) {
    const end = s2.endBeat != null ? s2.endBeat : s2.startBeat + s2.bars * 4;
    if (beat <= end || s2 === secs[secs.length - 1]) {
      const span = Math.max(1, end - s2.startBeat);
      const ratio = Math.max(0, Math.min(1, (beat - s2.startBeat) / span));
      return (s2.startBar || 0) + ratio * s2.bars;
    }
  }
  return beat / 4;
}

function drawStatic() {
  const ctx = staticCtx;
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, L.w, L.h);
  ctx.fillStyle = 'rgba(5, 7, 10, .72)'; ctx.fillRect(0, 0, L.padL, L.h);
  if (!piece) return;
  const totalBeats = piece.meta.beats;

  piece.sections.forEach((s, i) => {
    const endB = s.endBeat != null ? s.endBeat : s.startBeat + s.bars * 4;
    const x0 = xForBeat(s.startBeat), x1 = xForBeat(endB);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.016)' : 'rgba(255,255,255,.005)';
    ctx.fillRect(x0, L.padT - 12, x1 - x0, L.h - L.padT - L.padB);
    ctx.fillStyle = s.color ? hexA(s.color, 0.95) : 'rgba(238,203,141,.92)';
    ctx.font = '11.5px "Songti SC", "PingFang SC", serif';
    ctx.textAlign = 'left';
    const label = piece.meta.segmented && s.bpm ? `${s.name} ${s.bpm}` : s.name;
    ctx.fillText(label, x0 + 7, L.padT - 5);
    ctx.strokeStyle = 'rgba(217,164,65,.18)';
    ctx.beginPath(); ctx.moveTo(x0, L.padT - 11); ctx.lineTo(x0 + 22, L.padT - 11); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.moveTo(x1, L.padT - 12); ctx.lineTo(x1, L.h - L.padB); ctx.stroke();
  });

  const sparse = L.w < 620;
  for (let s = L.minStep; s <= L.maxStep; s++) {
    const y = yForStep(s), d = stepDegree(s);
    ctx.strokeStyle = d === 0 ? 'rgba(217,164,65,.22)' : 'rgba(255,255,255,.045)';
    ctx.beginPath(); ctx.moveTo(L.padL, y + L.rowH / 2); ctx.lineTo(L.w - L.padR, y + L.rowH / 2); ctx.stroke();
    if (sparse && d !== 0) continue;
    ctx.fillStyle = d === 0 ? 'rgba(238,203,141,.95)' : 'rgba(255,255,255,.52)';
    ctx.font = `${d === 0 ? 11.5 : 10.5}px "Songti SC", serif`;
    ctx.textAlign = 'right';
    ctx.fillText(DEGREES[d], L.padL - 12, y + L.rowH / 2 + 3.4);
    if (stepOctave(s) > 0) {
      ctx.beginPath(); ctx.arc(L.padL - 8, y + L.rowH / 2 - 3.2, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  for (let b = 0; b <= totalBeats; b++) {
    const x = xForBeat(b), bar = b % 4 === 0;
    ctx.strokeStyle = bar ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.moveTo(x, L.padT - 12); ctx.lineTo(x, L.h - L.padB); ctx.stroke();
    if (bar) {
      const rb = realBarAt(b);
      // 只用「接近整数」的真实小节号来标，避免多段模式下刻度糊成一片
      const near = Math.abs(rb - Math.round(rb)) < 0.22;
      const every = L.w < 620 ? 4 : (piece.meta.segmented ? 2 : 1);
      if (near && Math.round(rb) % every === 0) {
        ctx.fillStyle = 'rgba(255,255,255,.30)';
        ctx.font = '9.5px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(String(Math.round(rb) + 1), x + 3, L.h - 4);
      }
    }
  }

  const noteH = Math.max(5, L.rowH * 0.56);
  for (const n of piece.notes) {
    const col = piece.trackDefs[n.track]?.color || '#d9a441';
    if (n.step == null) {
      const x = xForBeat(n.t);
      const y = L.h - L.padB - L.ambH - L.percH + 4;
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
  }

  if (L.percH) {
    const y = L.h - L.padB - L.ambH - L.percH;
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.beginPath(); ctx.moveTo(L.padL, y); ctx.lineTo(L.w - L.padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.font = '9.5px "PingFang SC", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('打击', L.padL - 10, y + 14);
  }
  if (L.ambH) {
    const y = L.h - L.padB - L.ambH;
    const col = piece.trackDefs[piece.ambience[0].track]?.color || '#6fb7c8';
    ctx.fillStyle = hexA(col, 0.16);
    ctx.fillRect(L.padL, y + 2, L.w - L.padL - L.padR, L.ambH - 4);
    ctx.fillStyle = hexA(col, 0.7); ctx.font = '9.5px "PingFang SC", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('氛围', L.padL - 10, y + 10);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.moveTo(L.padL, 0); ctx.lineTo(L.padL, L.h); ctx.stroke();
}

function paint() {
  if (!L.w) return;
  rollCtx.clearRect(0, 0, L.w, L.h);
  rollCtx.drawImage(staticCanvas, 0, 0, L.w, L.h);
  if (!piece) return;
  const pos = player.position;
  const beat = Math.min(piece.meta.beats, pos / (60 / piece.meta.bpm));
  const x = xForBeat(beat);
  const grad = rollCtx.createLinearGradient(x - 14, 0, x + 14, 0);
  grad.addColorStop(0, 'rgba(217,164,65,0)');
  grad.addColorStop(0.5, 'rgba(217,164,65,.16)');
  grad.addColorStop(1, 'rgba(217,164,65,0)');
  rollCtx.fillStyle = grad;
  rollCtx.fillRect(x - 14, L.padT - 12, 28, L.h - L.padT - L.padB);
  rollCtx.save();
  rollCtx.shadowColor = 'rgba(240,205,140,.65)'; rollCtx.shadowBlur = 8;
  rollCtx.strokeStyle = 'rgba(248,220,164,.98)'; rollCtx.lineWidth = 1.6;
  rollCtx.beginPath(); rollCtx.moveTo(x, L.padT - 12); rollCtx.lineTo(x, L.h - L.padB); rollCtx.stroke();
  rollCtx.restore();
  rollCtx.fillStyle = 'rgba(248,220,164,.95)';
  rollCtx.beginPath();
  rollCtx.moveTo(x - 5, L.padT - 21); rollCtx.lineTo(x + 5, L.padT - 21); rollCtx.lineTo(x, L.padT - 12);
  rollCtx.closePath(); rollCtx.fill();
  if (hoverNote?.step != null) {
    const hx = xForBeat(hoverNote.t), hw = Math.max(2.5, xForBeat(hoverNote.t + hoverNote.dur) - hx - 1.2);
    const y = yForStep(hoverNote.step) + (L.rowH - L.rowH * 0.56) / 2;
    rollCtx.strokeStyle = 'rgba(255,255,255,.55)';
    roundRect(rollCtx, hx, y, hw, L.rowH * 0.56, 3); rollCtx.stroke();
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

/* ---------------- 播放 ---------------- */
async function togglePlay() {
  if (!piece) { await generate(); if (!piece) return; }
  if (player.playing) {
    player.pause();
    $('btnPlay').classList.remove('playing');
    $('btnPlay').querySelector('i').textContent = '▶';
    $('btnPlay').querySelector('span').textContent = '播放';
  } else {
    await player.play();
    $('btnPlay').classList.add('playing');
    $('btnPlay').querySelector('i').textContent = '❚❚';
    $('btnPlay').querySelector('span').textContent = '暂停';
  }
}
function stopAll() {
  player.stop();
  $('btnPlay').classList.remove('playing');
  $('btnPlay').querySelector('i').textContent = '▶';
  $('btnPlay').querySelector('span').textContent = '播放';
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
  const btn = $('btnWav'), old = btn.innerHTML;
  btn.disabled = true; btn.textContent = '渲染中…';
  try {
    const buf = await player.renderOffline(piece, { mute: player.mute, solo: player.solo, gains: player.gains });
    const ab = audioBufferToWav(buf);
    const name = `${sanitizeName(piece.meta.title)}_${piece.meta.key}${piece.meta.modeName}_${piece.meta.bpm}bpm${piece.meta.loop ? '_loop' : ''}.wav`;
    downloadBlob(new Blob([ab], { type: 'audio/wav' }), name);
    toast(`已导出 ${name} · ${(ab.byteLength / 1048576).toFixed(1)} MB`, 3600);
  } catch (e) {
    console.error(e); toast('导出失败：' + e.message, 4000);
  } finally { btn.disabled = false; btn.innerHTML = old; }
}
function exportMidi() {
  if (!piece) return toast('先生成一首曲子');
  const name = `${sanitizeName(piece.meta.title)}_${piece.meta.key}${piece.meta.modeName}.mid`;
  downloadMidi(piece, name);
  toast(`已导出 ${name} · 可直接拖进 DAW`, 3200);
}

/* ---------------- 作品库 ---------------- */
function savePiece() {
  if (!piece) return toast('还没有作品');
  const list = library();
  list.unshift({ id: 'w' + Date.now(), at: Date.now(), piece });
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
        piece = item.piece;
        settings.tracks = piece.spec || piece.tracks.map(t => ({ role: t.role, inst: t.inst }));
        settings.mood = piece.meta.mood; settings.mode = piece.meta.mode;
        settings.key = piece.meta.key; settings.bpm = piece.meta.bpm;
        settings.density = Math.round(piece.meta.density * 100);
        settings.bars = piece.meta.bars; seedNum = piece.meta.seed; seedSource = 'user';
        settings.title = piece.meta.title; settings.reason = piece.meta.reason;
        syncUI();
        player.stop(); player.mute.clear(); player.solo = null; volume = {};
        renderAll(); applyVolumes();
        toast(`已载入《${piece.meta.title}》`);
      } else {
        setLibrary(list2.filter(x => x.id !== li.dataset.id));
        renderLibrary();
      }
    });
  });
}

/* ---------------- 分享 / 地址栏 ---------------- */
function updateHash() {
  if (!piece) return;
  const tracks = (piece.spec || []).map(t => `${t.role}:${t.inst}`).join(',');
  const params = new URLSearchParams({
    seed: String(piece.meta.seed), mood: piece.meta.mood, mode: piece.meta.mode,
    key: piece.meta.key, bpm: piece.meta.bpm, density: Math.round(piece.meta.density * 100),
    bars: piece.meta.bars, tracks, loop: piece.meta.loop ? 1 : 0,
  });
  history.replaceState(null, '', '#' + params.toString());
}
function shareLink() {
  const tracks = (settings.tracks || []).map(t => `${t.role}:${t.inst}`).join(',');
  return location.href.split('#')[0] + '#' + new URLSearchParams({
    seed: seedNum || settings.seed || '', mood: settings.mood, mode: settings.mode,
    key: settings.key, bpm: settings.bpm, density: settings.density,
    bars: settings.bars, tracks, loop: settings.loop ? 1 : 0,
  }).toString();
}
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
  settings.bars = Number(p.get('bars') ?? settings.bars);
  settings.seed = p.get('seed') || '';
  settings.loop = p.get('loop') === '1';
  const tracks = p.get('tracks');
  if (tracks) {
    settings.tracks = tracks.split(',').map(x => {
      const [role, inst] = x.split(':');
      return { role, inst };
    }).filter(t => t.role && t.inst);
  }
  settings.ai = false;
  syncUI();
  return true;
}

/* ---------------- 试听 ---------------- */
async function audition(id) {
  try {
    await player.ensure();
    let buf;
    if (INSTRUMENTS[id].family === 'amb') buf = renderAmbience(id, 4, new Rng(Math.random() * 1e9));
    else buf = renderDemo(id, currentRoot(), new Rng(Math.random() * 1e9));
    const ab = player.ctx.createBuffer(1, buf.length, 44100);
    ab.copyToChannel(buf, 0);
    const src = player.ctx.createBufferSource(); src.buffer = ab;
    const g = player.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(player.master); src.start();
    toast(`试听：${INSTRUMENTS[id].name}`);
  } catch (e) { toast('试听失败：' + e.message); }
}

/* ---------------- 参数说明 ---------------- */
const OPT_TABLES = {
  texture: TEXTURES, harmony: HARMONY_STYLES, form: FORMS, joint: JOINTS,
  ornament: ORNAMENT_LEVELS, dynamics: DYNAMICS, banship: BANSHI, space: SPACES,
};
function openParamDoc() {
  const rows = Object.entries(PARAM_DOC).map(([key, doc]) => {
    const tbl = OPT_TABLES[key];
    const opts = doc.options
      ? doc.options.map(o => `<span class="opt">${o}</span>`).join('')
      : tbl
        ? Object.values(tbl).map(v => `<span class="opt" title="${v.desc || ''}">${v.name}</span>`).join('')
        : '';
    return `<dl class="param-doc"><dt>${doc.label}</dt><dd>${doc.desc}${opts ? `<div class="opts">${opts}</div>` : ''}</dd></dl>`;
  }).join('');
  $('paramDocList').innerHTML = rows;
  $('paramModal').hidden = false;
}

/* ---------------- APK / API 分栏 ---------------- */
const API_BASE = location.origin + location.pathname.replace(/[^/]*$/, '');

function fmtBytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

let apkLoaded = false;
async function loadApkInfo() {
  if (apkLoaded) return;
  apkLoaded = true;
  try {
    const res = await fetch('api/apk');
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || '无法读取');
    $('apkName').textContent = d.app + ' · v' + d.versionName;
    $('apkMeta').textContent = `${d.package} · Android ${d.minSdk}+ · ${fmtBytes(d.sizeBytes)}`;
    const a = $('apkDownload');
    a.href = d.downloadUrl;
    a.textContent = `下载 APK（${fmtBytes(d.sizeBytes)}）`;
    a.setAttribute('download', '');
    $('apkPkg').textContent = d.package || d['package'];
    $('apkVer').textContent = `v${d.versionName}（${d.versionCode}）`;
    $('apkSize').textContent = `${fmtBytes(d.sizeBytes)}（${d.sizeBytes.toLocaleString()} 字节）`;
    $('apkMin').textContent = `Android ${d.minSdk}+ · target ${d.targetSdk}`;
    $('apkSha').textContent = d.sha256;
    $('apiSample').textContent = JSON.stringify({
      ok: true, app: d.app, package: d.package,
      versionName: d.versionName, versionCode: d.versionCode,
      sizeBytes: d.sizeBytes, sha256: d.sha256.slice(0, 16) + '…',
      downloadUrl: d.downloadUrl,
      hotUpdate: d.hotUpdate,
    }, null, 2);
  } catch (e) {
    $('apkMeta').textContent = '版本信息读取失败：' + e.message;
    $('apiSample').textContent = '读取失败：' + e.message;
  }
}

function openApkModal(tab = 'download') {
  $('apkModal').hidden = false;
  switchApkTab(tab);
  loadApkInfo();
}
function switchApkTab(name) {
  document.querySelectorAll('#apkTabs .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('#apkModal .tab-pane').forEach(p => p.hidden = p.dataset.pane !== name);
  $('apiBase').textContent = API_BASE.replace(/\/$/, '');
}

/* ---------------- 事件 ---------------- */
function bind() {
  $('inspire').addEventListener('input', e => { settings.inspire = e.target.value; saveSettings(); });
  $('aiToggle').addEventListener('change', e => { settings.ai = e.target.checked; saveSettings(); });
  $('loopToggle').addEventListener('change', e => {
    settings.loop = e.target.checked; saveSettings();
    if (piece) flagPending(); else generate();
  });

  $('moodChips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    settings.mood = b.dataset.mood;
    const m = MOOD_BY_ID[settings.mood];
    if (!isLocked('bpm')) settings.bpm = m.bpm;
    if (!isLocked('density')) settings.density = Math.round(m.density * 100);
    if (!isLocked('tracks')) settings.tracks = defaultTracks(m);
    syncUI(); saveSettings();
    if (piece) flagPending(); else generate();
  });

  // 参数改动只做标记，点「生成编曲」才真正重排
  const markDirty = () => { saveSettings(); syncUI(); if (piece) flagPending(); };
  $('bpm').addEventListener('input', () => { settings.bpm = +$('bpm').value; markDirty(); });
  $('density').addEventListener('input', () => { settings.density = +$('density').value; markDirty(); });
  $('bars').addEventListener('input', () => { settings.bars = +$('bars').value; markDirty(); });
  $('mode').addEventListener('change', () => { settings.mode = +$('mode').value; markDirty(); });
  for (const id of ['texture', 'harmony', 'joint', 'ornament', 'dynamics', 'banship', 'space']) {
    $(id).addEventListener('change', () => { settings[id] = $(id).value; markDirty(); });
  }
  $('form').addEventListener('change', () => {
    settings.form = $('form').value;
    // 选「闭环循环」曲式时，顺手打开循环开关
    if (settings.form === 'loop') { settings.loop = true; $('loopToggle').checked = true; }
    markDirty();
  });
  $('key').addEventListener('change', () => { settings.key = $('key').value; markDirty(); });
  $('seed').addEventListener('input', e => {
    settings.seed = e.target.value;
    seedSource = e.target.value.trim() === '' ? 'auto' : 'user';
    saveSettings();
  });
  $('dice').addEventListener('click', () => {
    settings.seed = String(Math.floor(Math.random() * 999999));
    seedSource = 'user';
    $('seed').value = settings.seed;
  if ($('segBars')) { $('segBars').value = settings.segBars || 24; $('segBarsVal').textContent = settings.segBars || 24; } saveSettings();
    if (piece) { seedNum = +settings.seed; flagPending(); }
  });

  $('btnGenerate').addEventListener('click', () => generate());
  $('genCancel').addEventListener('click', () => {
    genState.cancelled = true;
    closeGen();
    player.pause();
    toast('已取消生成');
    busy = false;
    $('btnGenerate').disabled = false;
  });
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnStop').addEventListener('click', stopAll);
  $('btnLoop').addEventListener('click', () => {
    player.loop = !player.loop;
    $('btnLoop').textContent = player.loop ? '循环开' : '循环';
    $('btnLoop').classList.toggle('on', player.loop);
    if (player.playing) player.play(player.position); // 立即按新的循环状态重排
  });
  $('btnWav').addEventListener('click', exportWav);
  $('btnMidi').addEventListener('click', exportMidi);
  $('btnSave').addEventListener('click', savePiece);

  document.querySelectorAll('.lk[data-lock]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      toggleLock(el.dataset.lock);
    });
  });
  $('btnLockAll').addEventListener('click', () => {
    settings.locks = {};
    for (const k of LOCKABLE) settings.locks[k] = true;
    saveSettings(); renderLocks();
    toast('已锁定全部参数');
  });
  $('btnUnlockAll').addEventListener('click', () => {
    settings.locks = {};
    saveSettings(); renderLocks();
    toast('已清空锁定');
  });
  $('btnLockTracks').addEventListener('click', () => toggleLock('tracks'));
  $('btnAddSeg').addEventListener('click', () => {
    const list = segsOf();
    const used = new Set(list.map(s => s.mood));
    const pick = MOODS.find(m => !used.has(m.id)) || MOODS[0];
    list.push({ mood: pick.id, bars: 8, bpm: pick.bpm, transitionIn: 'bridge', label: pick.name });
    setSegs(list);
  });
  $('btnArc').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('arcMenu');
    if (!menu.hidden) { menu.hidden = true; return; }
    menu.innerHTML = Object.values(ARCS).map(a =>
      `<button data-arc="${a.id}"><b>${a.name}</b><em>${a.desc}</em></button>`).join('');
    menu.hidden = false;
    menu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const arc = ARCS[b.dataset.arc];
        const n = arc.moods.length;
        const per = Math.max(4, Math.round((settings.segBars || 24) / n));
        setSegs(arc.moods.map((mid, i) => ({
          mood: mid, bars: per, bpm: MOOD_BY_ID[mid]?.bpm,
          density: Math.round((MOOD_BY_ID[mid]?.density ?? 0.5) * 100),
          transitionIn: i === 0 ? 'cut' : 'bridge',
          label: MOOD_BY_ID[mid]?.name || mid,
        })));
        menu.hidden = true;
        toast(`已套用：${arc.name}`);
      });
    });
  });
  document.addEventListener('click', e => {
    if (!$('arcMenu').hidden && !e.target.closest('.struct-card')) $('arcMenu').hidden = true;
  });
  $('segBars').addEventListener('input', () => {
    settings.segBars = +$('segBars').value;
    $('segBarsVal').textContent = settings.segBars;
    saveSettings();
    if (piece) flagPending();
  });
  $('segTransition').addEventListener('change', () => {
    settings.segTransition = $('segTransition').value;
    // 应用到所有非首段
    const list = segsOf();
    for (let i = 1; i < list.length; i++) list[i].transitionIn = settings.segTransition;
    setSegs(list);
  });
  $('btnParamDoc').addEventListener('click', openParamDoc);
  $('closeParam').addEventListener('click', () => $('paramModal').hidden = true);
  $('paramModal').addEventListener('click', e => { if (e.target.id === 'paramModal') $('paramModal').hidden = true; });
  $('btnApk').addEventListener('click', () => openApkModal('download'));
  $('closeApk').addEventListener('click', () => $('apkModal').hidden = true);
  $('apkModal').addEventListener('click', e => { if (e.target.id === 'apkModal') $('apkModal').hidden = true; });
  $('apkTabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) switchApkTab(t.dataset.tab);
  });
  $('btnTheory').addEventListener('click', () => $('theoryModal').hidden = false);
  $('closeTheory').addEventListener('click', () => $('theoryModal').hidden = true);
  $('theoryModal').addEventListener('click', e => { if (e.target.id === 'theoryModal') $('theoryModal').hidden = true; });
  $('btnShare').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareLink()); toast('链接已复制 · 打开即还原这首曲子'); }
    catch { toast(shareLink(), 6000); }
  });

  $('btnAddTrack').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('addMenu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', e => {
    if (!$('addMenu').hidden && !e.target.closest('.mix-actions')) $('addMenu').hidden = true;
  });

  $('timbreList').addEventListener('click', e => {
    const b = e.target.closest('.timbre'); if (!b) return;
    audition(b.dataset.inst);
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
    } else { hoverNote = null; tip.style.opacity = '0'; }
    if (!player.playing) paint();
  });
  roll.addEventListener('mouseleave', () => { hoverNote = null; $('rollTip').style.opacity = '0'; if (!player.playing) paint(); });

  player.onended = () => {
    $('btnPlay').classList.remove('playing');
    $('btnPlay').querySelector('i').textContent = '▶';
    $('btnPlay').querySelector('span').textContent = '播放';
  };

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
      playPad(base + idx, document.querySelectorAll('.key')[idx]);
    }
  });
}

/* ---------------- 启动 ---------------- */
async function main() {
  initControls();
  bind();
  renderLocks();
  buildKeys();
  renderLibrary();
  tick();
  const fromHash = applyHash();
  if (fromHash) {
    seedNum = Number(settings.seed) || Math.floor(Math.random() * 1e9);
    seedSource = 'user';
    await buildPiece({ seed: seedNum, engine: 'rule', title: '', reason: '' });
  }
}

window.__ws = { player, get piece() { return piece; }, get settings() { return settings; } };
main();
