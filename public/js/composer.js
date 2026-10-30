// AI 编曲：角色化音轨（主旋律/副旋律/铺底/低音/打击/氛围）
// 动机生成 → 模进/变奏 → 配器 → 人声化微扰。规则驱动，同一 seed 可复现。
import { Rng } from './rng.js';
import { MODES, KEYS, MOOD_BY_ID, makeTitle, stepToMidi, stepDegree, DEGREE_SEMIS } from './theory.js';
import { INSTRUMENTS } from './synth.js';
import {
  TEXTURES, HARMONY_STYLES, BANSHI, ORNAMENT_LEVELS, DYNAMICS,
  FORMS, MOOD_ENSEMBLE, BAYIN,
} from './techniques.js';

export const ROLES = {
  lead: { name: '主旋律', color: '#e7b45c', gain: 0.95, pan: -0.06 },
  harm: { name: '副旋律', color: '#7fc8b0', gain: 0.55, pan: 0.18 },
  pad: { name: '铺底', color: '#a99bf0', gain: 0.30, pan: 0.0 },
  bass: { name: '低音', color: '#9dabbb', gain: 0.52, pan: -0.1 },
  perc: { name: '打击', color: '#d98c8c', gain: 0.52, pan: 0.12 },
  amb: { name: '氛围', color: '#6fb7c8', gain: 0.36, pan: 0.0 },
};
export const ROLE_IDS = Object.keys(ROLES);

// 各乐器的舒适音区（音级步进，0 = 该八度宫音）
const REGISTER = {
  // 丝 — 弹拨
  guqin: [1, 9], guzheng: [2, 12], pipa: [4, 13], liuqin: [7, 16],
  yueqin: [4, 13], sanxian: [2, 11], ruan: [2, 11], konghou: [5, 15], yangqin: [3, 13],
  // 丝 — 拉弦
  erhu: [4, 12], jinghu: [7, 15], banhu: [5, 13],
  // 竹 / 匏 / 土 — 吹管
  dizi: [5, 14], xiao: [2, 10], xun: [3, 10], sheng: [4, 13],
  suona: [6, 15], guanzi: [4, 12], hulusi: [4, 12], bawu: [3, 11], ocarina: [4, 12],
  // 金 / 石
  bianzhong: [2, 11], bianqing: [7, 16], gong: [-5, 2], pengling: [8, 16],
  // 革 / 木
  drum: [-5, 0], paigu: [-3, 4], muyu: [0, 4], bangzi: [4, 8],
  // 电子
  pad: [0, 8], bass: [-6, 0],
};
const isAmb = inst => INSTRUMENTS[inst]?.family === 'amb';
const isPerc = inst => INSTRUMENTS[inst]?.family === 'perc';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// 循环曲式的「回旋音」：纯五度就落在属音上，否则回主音（角调式等）
function turnaroundDegree(mode) {
  const d = (mode.tonic + 3) % 5;
  let semis = DEGREE_SEMIS[d] - DEGREE_SEMIS[mode.tonic];
  if (semis <= 0) semis += 12;
  return semis === 7 ? d : mode.tonic;
}

/* ---------------- 音轨规格 ---------------- */

export function defaultTracks(mood) {
  const ens = MOOD_ENSEMBLE[mood.id];
  if (ens) return ens.map(t => ({ ...t }));
  // 兜底：按 palette 推
  const pal = mood.palette || [];
  const melodic = p => !['pad', 'bass', 'drum', 'muyu', 'gong'].includes(p);
  const lead = pal.find(melodic) || pal[0] || 'guzheng';
  const out = [{ role: 'lead', inst: lead }];
  const harm = pal.find(p => p !== lead && !isPerc(p) && p !== 'bass' && p !== 'pad');
  if (harm) out.push({ role: 'harm', inst: harm });
  if (pal.includes('pad')) out.push({ role: 'pad', inst: 'pad' });
  out.push({ role: 'bass', inst: 'bass' });
  if (pal.includes('drum')) out.push({ role: 'perc', inst: 'drum' });
  return out;
}

// 每个角色允许的数量：副旋律最多 2 个（音区错开），其余各 1
const ROLE_QUOTA = { lead: 1, harm: 2, pad: 2, bass: 1, perc: 1, amb: 1 };
const MAX_TRACKS = 6;

export function normalizeTracks(list, mood) {
  const ok = [];
  const count = {};
  const seenInst = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (!t) continue;
    const role = ROLE_IDS.includes(t.role) ? t.role : null;
    const inst = INSTRUMENTS[t.inst] ? t.inst : null;
    if (!role || !inst) continue;
    if ((count[role] || 0) >= (ROLE_QUOTA[role] || 1)) continue;
    if (seenInst.has(inst)) continue; // 同一乐器不重复出现
    if (role === 'lead' && (isAmb(inst) || isPerc(inst))) continue;
    if (role !== 'amb' && isAmb(inst)) continue;
    if (role === 'amb' && !isAmb(inst)) continue;
    if (role === 'perc' && !isPerc(inst) && inst !== 'gong') continue;
    count[role] = (count[role] || 0) + 1;
    seenInst.add(inst);
    ok.push({ role, inst });
    if (ok.length >= MAX_TRACKS) break;
  }
  if (!ok.some(t => t.role === 'lead')) {
    const fallback = defaultTracks(mood).find(t => t.role === 'lead');
    ok.unshift(fallback || { role: 'lead', inst: 'guzheng' });
  }
  return ok;
}

/* ---------------- 曲式 ---------------- */

function buildSections(bars, loop, formId) {
  if (loop) {
    const count = Math.min(8, Math.max(2, Math.round(bars / 4)));
    const names = ['起', '承', '转', '合', '展', '收', '变', '终'];
    const base = Math.floor(bars / count);
    const extra = bars - base * count;
    const out = [];
    for (let i = 0; i < count; i++) out.push({ name: names[i], bars: base + (i < extra ? 1 : 0) });
    return out;
  }
  const form = FORMS[formId] || FORMS.qichengzhuanhe;
  // 按权重把总小节数分配到各段
  const weights = form.plan.map(([, w]) => w);
  const sumW = weights.reduce((a, b) => a + b, 0);
  let used = 0;
  const out = form.plan.map(([name, w], i) => {
    let n = i === form.plan.length - 1
      ? bars - used
      : Math.max(1, Math.round(bars * w / sumW));
    used += n;
    return { name, bars: n };
  });
  // 修正舍入误差
  const diff = bars - out.reduce((a, s2) => a + s2.bars, 0);
  if (diff !== 0) out[out.length - 1].bars = Math.max(1, out[out.length - 1].bars + diff);
  // 散板段不占整小节时，合并到相邻段避免出现 0 小节
  return out.filter(s2 => s2.bars > 0);
}

/* ---------------- 乐句衔接：鱼咬尾 / 换头合尾 ---------------- */

// 把上一句的尾音接到下一句的开头（鱼咬尾）
function applyYaoWeiTail(phrase, prevTail) {
  if (prevTail == null || !phrase.length) return phrase;
  const first = phrase.reduce((a, b) => (a.t <= b.t ? a : b));
  if (Math.abs(first.step - prevTail) > 4) return phrase; // 差太远就不硬接
  first.step = prevTail;
  return phrase;
}

const tailStepOf = (phrase) => {
  const cad = phrase.find(n => n.cadence);
  return cad ? cad.step : null;
};

/* ---------------- 旋律动机 ---------------- */

function barRhythm(rng, density, grid) {
  const onsets = [];
  for (let b = 0; b < 4 - 1e-9; b += grid) {
    const accent = b === 0 ? 1.7 : b === 2 ? 1.35 : b === 1 || b === 3 ? 1.1 : 0.85;
    if (rng.chance(density * accent)) onsets.push(+b.toFixed(2));
  }
  if (!onsets.length) onsets.push(rng.chance(0.5) ? 0 : 2);
  return onsets;
}

function stepsWithDegree(deg, lo, hi) {
  const out = [];
  for (let s = lo; s <= hi; s++) if (stepDegree(s) === ((deg % 5) + 5) % 5) out.push(s);
  return out;
}

// 生成一个乐句，返回相对时间（从 0 开始）的音符数组
function genPhrase(rng, opts) {
  const { bars, register, kind, density, mode, contour } = opts;
  const grid = density > 0.62 ? 0.5 : 1;
  const [lo, hi] = register;
  const tonicSteps = stepsWithDegree(mode.tonic, lo, hi);
  const fifthSteps = stepsWithDegree(mode.tonic + 3, lo, hi);
  const ev = [];
  let s = rng.pick(tonicSteps) || Math.round((lo + hi) / 2);
  if (kind === 'contrast') s = clamp(s + rng.pick([2, 3, -2]), lo, hi);

  const contourBias = p => {
    if (contour === 'arch') return Math.sin(Math.PI * p) * 2 - 1;
    if (contour === 'asc') return p * 2 - 1;
    if (contour === 'desc') return 1 - p * 2;
    return Math.sin(Math.PI * 2 * p) * 0.8;
  };

  for (let b = 0; b < bars; b++) {
    const onsets = barRhythm(rng, density * (kind === 'intro' ? 0.45 : 1), grid);
    for (let i = 0; i < onsets.length; i++) {
      const o = onsets[i];
      const next = i + 1 < onsets.length ? onsets[i + 1] : 4;
      let dur = Math.max(0.25, next - o);
      if (dur > 2.5) dur = rng.pick([1.5, 2, 2.5]);
      const progress = (b + o / 4) / Math.max(1, bars);
      const target = (lo + hi) / 2 + contourBias(progress) * ((hi - lo) * 0.38);
      const dir = s < target ? 1 : -1;
      const move = rng.weighted([
        { w: 4, v: dir * 1 }, { w: 3, v: dir * 2 }, { w: 1.4, v: -dir * 1 },
        { w: 1, v: dir * 3 }, { w: 0.6, v: 0 }, { w: 0.8, v: -dir * 2 },
      ]).v;
      s = clamp(s + move, lo, hi);
      if (Math.abs(move) >= 3 && rng.chance(0.65)) {
        const back = clamp(s - Math.sign(move) * 1, lo, hi);
        ev.push({ step: back, t: b * 4 + o, dur: Math.min(0.5, dur), vel: 0.5, grace: false, aux: true });
      }
      const vel = clamp(0.72 + (o === 0 ? 0.12 : 0) + rng.gauss() * 0.07, 0.35, 1);
      ev.push({ step: s, t: b * 4 + o, dur, vel, grace: false });
    }
  }

  // 句尾落音：奇句落徵、偶句落主音（合尾）
  const lastBar = bars - 1;
  const cand = kind === 'cadence'
    ? tonicSteps.filter(x => x >= lo + 2)
    : fifthSteps.filter(x => x >= lo + 2);
  const cad = rng.pick(cand.length ? cand : tonicSteps) || tonicSteps[0] || s;
  const cadT = lastBar * 4 + 2;
  // 落音前清掉同一拍上的普通音符，避免叠音
  for (let i = ev.length - 1; i >= 0; i--) {
    if (Math.abs(ev[i].t - cadT) < 0.6) ev.splice(i, 1);
  }
  ev.push({ step: cad, t: cadT, dur: 2, vel: 0.8, grace: false, cadence: true });
  return ev;
}

/* ---------------- 主体 ---------------- */

export function compose(opts = {}) {
  const moodId = opts.mood || 'qingya';
  const mood = MOOD_BY_ID[moodId] || MOOD_BY_ID.qingya;
  const modeIdx = opts.mode ?? 0;
  const mode = MODES[modeIdx] || MODES[0];
  const key = KEYS.find(k => k.name === (opts.key || 'C')) || KEYS[0];
  const bpm = clamp(Math.round(opts.bpm || mood.bpm), 40, 200);
  const density = clamp(opts.density ?? mood.density, 0.08, 1);
  const bars = clamp(Math.round(opts.bars || 20), 8, 48);
  const loop = !!opts.loop;
  const textureId = opts.texture || 'heterophony';
  const harmonyId = opts.harmony || 'open5';
  const formId = opts.form || (loop ? 'loop' : 'qichengzhuanhe');
  // 循环曲式必须匀速：否则首尾两段速度不同，循环点会「跳一下」
  const banshiId = loop ? 'steady' : (opts.banship || 'tempoCurve');
  const ornamentId = opts.ornament || 'some';
  const dynamicsId = opts.dynamics || 'natural';
  const spaceId = opts.space || 'hall';
  const jointId = opts.joint || 'yuyaowei';
  const texture = TEXTURES[textureId] || TEXTURES.heterophony;
  const harmony = HARMONY_STYLES[harmonyId] || HARMONY_STYLES.open5;
  const ornLevel = ORNAMENT_LEVELS[ornamentId] || ORNAMENT_LEVELS.some;
  const dyn = DYNAMICS[dynamicsId] || DYNAMICS.natural;
  const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
  const spec = normalizeTracks(opts.tracks && opts.tracks.length ? opts.tracks : defaultTracks(mood), mood);
  // 种子只含「音乐内容」参数（情绪/调式/主音/密度/篇幅），不含 bpm 与配器：
  //   - 改速度只改快慢，不重掷旋律
  //   - 换乐器只换音色，旋律骨架保留（这正是「锁种子换配器」的语义）
  const rng = new Rng(`${seed}|${moodId}|${modeIdx}|${key.name}|${density}|${bars}`);
  const title = opts.title || makeTitle(moodId, new Rng(`${seed}|title`));
  const rootMidi = key.midi;
  const secPerBeat = 60 / bpm;

  const sections = buildSections(bars, loop, formId);
  const barSec = [];
  let cursor = 0;
  for (const sec of sections) {
    sec.startBar = cursor;
    sec.startBeat = cursor * 4;
    for (let i = 0; i < sec.bars; i++) barSec.push(sec.name);
    cursor += sec.bars;
  }
  const totalBars = cursor;
  const totalBeats = totalBars * 4;
  const beatOf = b => b * 4;

  // 板式：各段速度倍率（散板更慢、快板更快）；匀速则全部 1
  const SPEED_BY_NAME = { 散: 0.62, 慢: 0.82, 引: 0.8, 起: 0.95, 承: 1.0, 转: 1.12, 展: 1.18, 收: 1.05, 合: 1.0, 快: 1.35, 尾: 0.7 };
  const useBanshi = banshiId !== 'steady';
  const secSpeed = new Map();
  sections.forEach((sec, i) => {
    let v = useBanshi ? (SPEED_BY_NAME[sec.name] ?? 1) : 1;
    if (banshiId === 'accelerando') v = 0.8 + 0.6 * (i / Math.max(1, sections.length - 1));
    secSpeed.set(sec, v);
  });

  // 建立音轨
  const tracks = [];
  const counter = {};
  for (const t of spec) {
    const role = ROLES[t.role];
    const n = (counter[t.role] = (counter[t.role] || 0) + 1);
    const id = n === 1 ? t.role : `${t.role}${n}`;
    tracks.push({
      id, role: t.role, inst: t.inst,
      name: role.name, instName: INSTRUMENTS[t.inst]?.name || t.inst,
      color: role.color, gain: role.gain, pan: role.pan,
      isAmb: isAmb(t.inst),
    });
  }
  const leadTrack = tracks.find(t => t.role === 'lead');
  const harmTracks = tracks.filter(t => t.role === 'harm');
  const padTracks = tracks.filter(t => t.role === 'pad');
  const bassTrack = tracks.find(t => t.role === 'bass');
  const percTrack = tracks.find(t => t.role === 'perc');

  const notes = [];
  const push = (track, n, inst) => notes.push({
    track: track.id, inst: inst || track.inst, ...n,
    midi: n.step == null ? 0 : stepToMidi(n.step, rootMidi),
  });

  // 段落力度（起承转合的能量曲线）
  // 段落能量：既覆盖四句体，也覆盖板式（散慢中快）
  const secEnergy = {
    引: 0.62, 散: 0.55, 慢: 0.68, 中: 0.85, 快: 1.0,
    起: 0.82, 承: 0.9, 转: 1.0, 合: 0.92, 展: 0.96, 收: 0.88, 尾: 0.7,
  };

  const leadReg = REGISTER[leadTrack.inst] || [3, 12];
  const contour = ['arch', 'asc', 'wave', 'desc'][rng.int(4)];
  const phraseMemo = {};
  let prevTail = null; // 上一句落音，供鱼咬尾使用

  for (const sec of sections) {
    const name = sec.name;
    const energy = secEnergy[name] ?? 0.85;

    if (name === '引' || (name === '散' && sec === sections[0])) {
      for (const pt of padTracks) {
        for (let b = 0; b < sec.bars; b++) {
          const step = leadReg[0] - 5;
          push(pt, { t: beatOf(sec.startBar + b), dur: 4, step, vel: 0.4 * energy });
        }
      }
      const intro = genPhrase(rng, {
        bars: sec.bars, register: [leadReg[0], leadReg[0] + 5],
        kind: 'intro', density: density * 0.55, mode, contour,
      });
      // 每个小节最多取一个点音，避免引子后半段空着
      const seen = new Set();
      const picked = [];
      for (const n of intro.filter(x => x.dur >= 0.8)) {
        const bar = Math.floor(n.t / 4);
        if (seen.has(bar)) continue;
        seen.add(bar);
        picked.push(n);
        if (picked.length >= Math.min(3, sec.bars)) break;
      }
      for (const n of picked) {
        push(leadTrack, { ...n, t: n.t + beatOf(sec.startBar), vel: n.vel * 0.6 });
      }
      continue;
    }

    if (name === '尾' || (name === '散' && sec === sections[sections.length - 1])) {
      const last = sec.startBar + sec.bars - 1;
      const cad = rng.pick(stepsWithDegree(mode.tonic, leadReg[0] + 1, leadReg[1] - 1)) || leadReg[0] + 2;
      // 尾段前半：一个短经过音，避免整段只有一个长音
      const passing = stepsWithDegree(stepDegree(cad) + 3, leadReg[0], leadReg[1])[0];
      if (passing != null && sec.bars >= 2) {
        push(leadTrack, {
          t: beatOf(sec.startBar) + 1.5, dur: 1.2,
          step: clamp(passing, leadReg[0], leadReg[1]), vel: 0.52,
        });
      }
      push(leadTrack, { t: beatOf(last), dur: 6, step: cad, vel: 0.72, cadence: true });
      if (bassTrack) push(bassTrack, { t: beatOf(sec.startBar), dur: sec.bars * 4 - 0.4, step: cad - 5, vel: 0.46 });
      for (const pt of padTracks) {
        push(pt, { t: beatOf(sec.startBar), dur: sec.bars * 4, step: cad - 5, vel: 0.32 });
        if (rng.chance(0.6)) push(pt, { t: beatOf(sec.startBar), dur: sec.bars * 4, step: cad, vel: 0.2 });
      }
      if (percTrack && (percTrack.inst === 'gong' || INSTRUMENTS[percTrack.inst]?.family === 'metal')) {
        push(percTrack, { t: beatOf(last), dur: 4, step: null, vel: 0.5 });
      }
      continue;
    }

    // 起承转合
    let phrase;
    // genPhrase 返回的是「从 0 开始」的相对时间，必须整体平移到本段落起点
    const offset = beatOf(sec.startBar);
    const shift = arr => arr.map(n => ({ ...n, t: n.t + offset }));
    if (name === '起') {
      phrase = shift(genPhrase(rng, { bars: sec.bars, register: leadReg, kind: 'theme', density, mode, contour }));
      phraseMemo.theme = phrase.map(n => ({ ...n, t: n.t - offset }));
    } else if (name === '承') {
      const base = phraseMemo.theme || [];
      phrase = shift(base.map(n => ({
        ...n,
        step: clamp(n.step + rng.pick([1, 2, 2, -1]), leadReg[0], leadReg[1]),
        vel: n.vel * 0.94,
      })));
    } else if (name === '转' || name === '展') {
      phrase = shift(genPhrase(rng, {
        bars: sec.bars, register: [clamp(leadReg[0] + 2, 0, 12), leadReg[1] + 1],
        kind: 'contrast', density: Math.min(1, density * 1.18), mode, contour,
      }));
    } else {
      const base = phraseMemo.theme ||
        genPhrase(rng, { bars: sec.bars, register: leadReg, kind: 'theme', density, mode, contour });
      phrase = shift(base.map(n => ({
        ...n,
        step: clamp(n.step + (n.cadence ? 0 : rng.pick([0, 0, 1])), leadReg[0], leadReg[1]),
      })));
    }

    // 装饰音：程度由 ornament 参数决定（乘以曲风自带的倾向）
    const ornP = { plain: 0.06, some: 0.34, rich: 0.75 }[ornamentId] * (0.6 + mood.ornaments * 0.6);
    if (ornP > 0.02) {
      const extra = [];
      for (const n of phrase) {
        if (n.grace || n.aux) continue;
        if (n.dur >= 1 && rng.chance(ornP)) {
          extra.push({
            step: clamp(n.step + rng.pick([1, 1, -1, 2]), leadReg[0], leadReg[1]),
            t: n.t - 0.16, dur: 0.16, vel: 0.45, grace: true,
          });
        }
        // 华丽时再加一个前倚音（同音快速交替）
        if (ornamentId === 'rich' && n.dur >= 2 && rng.chance(ornP * 0.45)) {
          extra.push({
            step: clamp(n.step - 1, leadReg[0], leadReg[1]),
            t: n.t - 0.3, dur: 0.14, vel: 0.36, grace: true,
          });
        }
      }
      phrase = phrase.concat(extra);
    }
    // 鱼咬尾：本句首音沿用上句末音
    if (jointId === 'yuyaowei' && prevTail != null) applyYaoWeiTail(phrase, prevTail);
    prevTail = tailStepOf(phrase);
    for (const n of phrase) push(leadTrack, { ...n, vel: n.vel * energy });

    // 循环模式的最后一句：落音改到属音，留一口气给开头
    if (loop && sec === sections[sections.length - 1]) {
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (n.track !== leadTrack.id) continue;
        if (!n.cadence) continue;
        const fifth = stepsWithDegree(turnaroundDegree(mode), leadReg[0] + 1, leadReg[1] - 1);
        n.step = fifth[0] ?? n.step;
        n.midi = stepToMidi(n.step, rootMidi);
        n.dur = Math.min(n.dur, 1.5);
        n.t = Math.min(n.t, totalBeats - 1.5);
        break;
      }
    }

    // 副旋律：按织体决定关系
    harmTracks.forEach((ht, idx) => {
      const reg = REGISTER[ht.inst] || [2, 10];
      const strong = phrase.filter(n => !n.grace && !n.aux && n.dur >= 0.5);
      if (texture.id === 'unison') {
        // 齐奏加花：跟着主旋律走，偶尔在上方加一个装饰音
        for (const n of strong) {
          const same = clamp(n.step + (idx === 0 ? 0 : 0), reg[0], reg[1]);
          if (same > reg[1] || same < reg[0]) continue;
          push(ht, { t: n.t + (idx === 0 ? 0 : 0.02), dur: n.dur, step: same, vel: n.vel * 0.46 * energy });
          if (!n.cadence && n.dur >= 1 && rng.chance(0.32)) {
            push(ht, { t: n.t + 0.18, dur: 0.18, step: clamp(same + 1, reg[0], reg[1]), vel: n.vel * 0.3 });
          }
        }
      } else if (texture.id === 'layered') {
        // 分层点染：只在句尾落一个长音
        const cad = phrase.find(n => n.cadence);
        if (cad) push(ht, { t: cad.t, dur: Math.max(2, cad.dur), step: clamp(cad.step - 2, reg[0], reg[1]), vel: 0.4 * energy });
      } else if (texture.id === 'homophony') {
        // 主调织体：与主旋律对齐，落在下方三度，时值拉长
        const picked = strong.filter((_, i) => i % (idx === 0 ? 2 : 3) === 0);
        for (const n of picked) {
          push(ht, { t: n.t, dur: Math.max(1, n.dur * 1.1), step: clamp(n.step - 2, reg[0], reg[1]), vel: n.vel * 0.45 * energy });
        }
      } else {
        // 支声复调：沿用主旋律骨架，只做加花与节奏分叉
        const offset = (idx + 1) * 0.5;
        for (const n of strong) {
          const grace = rng.chance(0.42);
          const step = clamp(n.step - (grace ? 1 : 0), reg[0], reg[1]);
          if (step < reg[0] || step > reg[1]) continue;
          push(ht, { t: n.t + offset, dur: Math.max(0.5, n.dur * 0.85), step, vel: n.vel * 0.48 * energy });
          // 支声的特征：同一旋律的「变体」，在长音处补一个回旋
          if (n.dur >= 1.5 && rng.chance(0.5)) {
            push(ht, {
              t: n.t + offset + n.dur * 0.55, dur: 0.3,
              step: clamp(step + rng.pick([2, 1, -1]), reg[0], reg[1]), vel: 0.3 * energy,
            });
          }
        }
      }
    });

    // 铺底：按和声手法叠置
    for (const pt of padTracks) {
      for (let b = 0; b < sec.bars; b += 2) {
        const deg = rng.pick([0, 3, 4, 1]);
        const base = clamp(deg - 5 + (REGISTER[pt.inst]?.[0] ?? 0), -8, 8);
        const t0 = beatOf(sec.startBar + b);
        const dur = Math.min(8, sec.bars * 4 - b * 4);
        if (harmony.id === 'none') continue;
        push(pt, { t: t0, dur, step: base, vel: 0.34 * energy });
        if (harmony.id === 'open5') {
          // 只用纯五度（音级步进 +3），不用三度
          push(pt, { t: t0, dur, step: base + 3, vel: 0.26 * energy });
          if (rng.chance(0.35)) push(pt, { t: t0, dur, step: base + 7, vel: 0.14 * energy });
        } else if (harmony.id === 'fourth') {
          // 四度叠置：+2 是四度音级（五声里 3→5 为小三度，2→5 为纯四度）
          push(pt, { t: t0, dur, step: base + 2, vel: 0.25 * energy });
          push(pt, { t: t0, dur, step: base + 5, vel: 0.18 * energy });
        } else if (harmony.id === 'addtone') {
          // 三度叠置 + 加二度/六度色彩音
          push(pt, { t: t0, dur, step: base + 2, vel: 0.27 * energy });
          push(pt, { t: t0, dur, step: base + 4, vel: 0.2 * energy });
          if (rng.chance(0.5)) push(pt, { t: t0, dur, step: base + 5, vel: 0.13 * energy });
        }
      }
    }
  }

  // 低音：和声进行
  if (bassTrack) {
    const prog = rng.pick(mood.prog || [[0, 4, 1, 0]]);
    for (let b = 0; b < totalBars; b++) {
      const sec = barSec[b];
      if (sec === '引' || sec === '尾') continue;
      let chordDeg = prog[b % prog.length];
      if (loop && b === totalBars - 1) chordDeg = turnaroundDegree(mode); // 末小节落回旋音
      const step = chordDeg - 5;
      push(bassTrack, { t: beatOf(b), dur: 3.6, step, vel: 0.6 + (b % 2 === 0 ? 0.06 : 0) });
      if (density > 0.55 && b % 2 === 1) {
        push(bassTrack, { t: beatOf(b) + 2, dur: 1.6, step: step + 2, vel: 0.42 });
      }
    }
  }

  // 打击
  if (percTrack) {
    const d = mood.drums ?? 0.4;
    for (let b = 0; b < totalBars; b++) {
      const sec = barSec[b];
      if (sec === '引' || sec === '尾') continue;
      const beat = beatOf(b);
      const pattern = [];
      if (rng.chance(d * 0.95)) pattern.push([0, 0.9]);
      if (rng.chance(d * 0.45)) pattern.push([2, 0.55]);
      for (let k = 0; k < 4; k++) if (rng.chance(d * 0.3)) pattern.push([k + 0.5, 0.32 + rng.next() * 0.15]);
      if (sec === '转' && b % 4 === 3) pattern.push([3.25, 0.5], [3.5, 0.6], [3.75, 0.75]);
      for (const [pos, v] of pattern) {
        const useMuyu = percTrack.inst === 'muyu' || (percTrack.inst === 'drum' && pos % 1 !== 0 && rng.chance(0.5));
        push(percTrack, {
          t: beat + pos, dur: 0.4, step: null, vel: clamp(v, 0.2, 1),
          inst: useMuyu ? 'muyu' : percTrack.inst,
        });
      }
    }
  }

  // 板式：把绝对拍按各段速度折算成「等效拍」，
  // 这样 player 用统一 BPM 就能得到变速效果（段内密度不变，段间快慢不同）
  if (useBanshi) {
    const spbBase = 60 / bpm;
    let accSec = 0;
    const segRanges = sections.map(sec => {
      const v = secSpeed.get(sec) || 1;
      const spb = spbBase / v;
      const start = sec.startBeat, end = sec.startBeat + sec.bars * 4;
      const rec = { start, end, accSec, spb };
      accSec += sec.bars * 4 * spb;
      return rec;
    });
    for (const n of notes) {
      const seg = segRanges.find(r => n.t >= r.start && n.t < r.end) || segRanges[segRanges.length - 1];
      const sec = seg.accSec + (n.t - seg.start) * seg.spb;
      n.t = sec / spbBase;
      n.dur = n.dur * seg.spb / spbBase;
    }
  }

  // 力度：按 dynamics 拉开或压平「段间」的强弱对比
  if (dynamicsId !== 'natural') {
    const flat = dynamicsId === 'flat';
    for (const n of notes) {
      const sec = barSec[Math.min(barSec.length - 1, Math.max(0, Math.floor(n.t / 4)))];
      const e = secEnergy[sec] ?? 0.85;
      // flat: 把所有段拉向 0.85；dramatic: 以 0.85 为中心放大差距
      const k = flat ? (0.85 / e) : (1 + (e - 0.85) * 1.2 / 0.85);
      n.vel = clamp(n.vel * k, 0.12, 1);
    }
  }

  // 人声化微扰：允许轻微抢拍/拖拍，但绝不能跨过小节线，
  // 否则低密度时会出现「看起来空着」的小节
  for (const n of notes) {
    if (n.step == null) { n.t = Math.max(0, n.t + rng.gauss() * 0.01); continue; }
    if (!n.cadence) {
      const bar = Math.floor(n.t / 4);
      let t = Math.max(0, n.t + rng.gauss() * 0.013);
      if (Math.floor(t / 4) !== bar) {
        // 越界就吸附回整拍，保持小结归属不变
        t = Math.round(t * 2) / 2;
        if (Math.floor(t / 4) !== bar) t = n.t;
      }
      n.t = t;
    }
    n.dur = Math.max(0.12, n.dur * (1 + rng.gauss() * 0.05));
    n.vel = clamp(n.vel * (1 + rng.gauss() * 0.06), 0.15, 1);
  }
  // 补洞：任何一个小节都不该完全没声音。
  // 优先用铺底挂长音，没有铺底用低音，再没有就让主旋律延一个音。
  {
    const cover = new Array(totalBars).fill(0);
    for (const n of notes) {
      if (n.step == null) continue;
      const b0 = Math.floor(n.t / 4);
      const b1 = Math.floor((n.t + Math.max(0.4, n.dur)) / 4);
      for (let b = Math.max(0, b0); b <= Math.min(cover.length - 1, b1); b++) cover[b]++;
    }
    const fillTrack = padTracks[0] || bassTrack || leadTrack;
    const fillReg = REGISTER[fillTrack.inst] || [0, 8];
    const holes = cover.map((c, i) => c === 0 ? i : -1).filter(i => i >= 0);
    for (const bar of holes) {
      const secName = barSec[bar] || '起';
      const energy = secEnergy[secName] ?? 0.8;
      const deg = rng.pick(stepsWithDegree(mode.tonic, fillReg[0], fillReg[1])) ?? Math.round((fillReg[0] + fillReg[1]) / 2);
      push(fillTrack, {
        t: beatOf(bar), dur: 4, step: deg,
        vel: clamp(0.3 * energy, 0.16, 0.6),
      });
    }
  }

  notes.sort((a, b) => a.t - b.t);

  // 变速重映射后，实际末拍可能不再等于名义拍数，必须据实修正，
  // 否则循环曲式帧数、时长显示、MIDI 时长都会错
  const actualEndBeat = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
  const effBeats = useBanshi ? Math.max(totalBeats, Math.ceil(actualEndBeat)) : totalBeats;

  const usedTracks = tracks.filter(t => t.isAmb || notes.some(n => n.track === t.id));
  const ambience = usedTracks.filter(t => t.isAmb).map(t => ({ track: t.id, inst: t.inst }));
  const instList = usedTracks.map(t => t.instName);

  const desc = [
    `${mode.name}（主音${key.name}，${mode.mood}）`,
    `${totalBars} 小节 · ${Math.round(totalBeats * secPerBeat)} 秒`,
    `配器 ${instList.join(' + ')}`,
  ].join(' ｜ ');

  return {
    meta: {
      title, mood: moodId, moodName: mood.name, mode: modeIdx, modeName: mode.name,
      key: key.name, rootMidi, bpm, seed, density, bars: totalBars, beats: effBeats,
      duration: effBeats * secPerBeat, loop,
      desc, engine: opts.engine || 'rule', reason: opts.reason || '',
      texture: textureId, harmony: harmonyId, form: formId, banshi: banshiId,
      ornament: ornamentId, dynamics: dynamicsId, space: spaceId, joint: jointId,
      palette: usedTracks.map(t => t.inst),
    },
    notes,
    sections: sections.map(s => ({ name: s.name, startBar: s.startBar, bars: s.bars, startBeat: s.startBeat })),
    tracks: usedTracks.map(t => ({
      id: t.id, role: t.role, inst: t.inst, instName: t.instName,
      name: t.name, color: t.color, gain: t.gain, pan: t.pan, isAmb: t.isAmb,
    })),
    trackDefs: Object.fromEntries(usedTracks.map(t => [t.id, { color: t.color, pan: t.pan, name: t.name }])),
    ambience,
    spec: spec.map(t => ({ role: t.role, inst: t.inst })),
  };
}
