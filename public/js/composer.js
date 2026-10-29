// AI 编曲：角色化音轨（主旋律/副旋律/铺底/低音/打击/氛围）
// 动机生成 → 模进/变奏 → 配器 → 人声化微扰。规则驱动，同一 seed 可复现。
import { Rng } from './rng.js';
import { MODES, KEYS, MOOD_BY_ID, makeTitle, stepToMidi, stepDegree } from './theory.js';
import { INSTRUMENTS } from './synth.js';

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
  guqin: [1, 9], xiao: [2, 10], erhu: [4, 12], dizi: [5, 13], pipa: [4, 13],
  suona: [5, 14], guzheng: [2, 12], bianzhong: [2, 11], yangqin: [3, 13],
  xun: [3, 10], pad: [0, 8], bass: [-6, 0],
};
const isAmb = inst => INSTRUMENTS[inst]?.family === 'amb';
const isPerc = inst => INSTRUMENTS[inst]?.family === 'perc';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/* ---------------- 音轨规格 ---------------- */

export function defaultTracks(mood) {
  const pal = mood.palette || [];
  const lead = pal[0] || 'guzheng';
  const harm = pal.find(p => p !== lead && !isPerc(p) && p !== 'bass') || 'dizi';
  const out = [{ role: 'lead', inst: lead }, { role: 'harm', inst: harm }];
  if (pal.includes('pad') || mood.id === 'chanyi') out.push({ role: 'pad', inst: 'pad' });
  if (pal.includes('bass')) out.push({ role: 'bass', inst: 'bass' });
  if (pal.includes('drum')) out.push({ role: 'perc', inst: 'drum' });
  else if (mood.id === 'chanyi') out.push({ role: 'perc', inst: 'muyu' });
  return out;
}

// 清洗外部传入（大模型）的音轨：合法角色/乐器、最多 6 轨、主旋律唯一
export function normalizeTracks(list, mood) {
  const ok = [];
  const used = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (!t) continue;
    const role = ROLE_IDS.includes(t.role) ? t.role : null;
    const inst = INSTRUMENTS[t.inst] ? t.inst : null;
    if (!role || !inst) continue;
    if (role === 'lead' && used.has('lead')) continue;
    if (role === 'lead' && (isAmb(inst) || isPerc(inst))) continue;
    if (role !== 'amb' && isAmb(inst)) continue;
    if (role === 'amb' && !isAmb(inst)) continue;
    if (role === 'perc' && !isPerc(inst) && inst !== 'gong') continue;
    used.add(role);
    ok.push({ role, inst });
    if (ok.length >= 6) break;
  }
  if (!ok.some(t => t.role === 'lead')) {
    const fallback = defaultTracks(mood).find(t => t.role === 'lead');
    ok.unshift(fallback || { role: 'lead', inst: 'guzheng' });
  }
  return ok;
}

/* ---------------- 曲式 ---------------- */

function buildSections(bars) {
  const intro = bars >= 14 ? 2 : 1;
  const outro = bars >= 12 ? 2 : 1;
  const body = Math.max(2, bars - intro - outro);
  // 最多 8 个乐句，多余的节数平摊到各句，避免名字重复
  const count = Math.min(8, Math.max(1, Math.ceil(body / 4)));
  const names = ['起', '承', '转', '合', '展', '收', '变', '终'];
  const base = Math.floor(body / count);
  const extra = body - base * count;
  const secs = [{ name: '引', bars: intro }];
  for (let i = 0; i < count; i++) {
    secs.push({ name: names[i], bars: base + (i < extra ? 1 : 0) });
  }
  secs.push({ name: '尾', bars: outro });
  return secs;
}

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
  ev.push({ step: cad, t: lastBar * 4 + 2, dur: 2, vel: 0.8, grace: false, cadence: true });
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
  const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
  const spec = normalizeTracks(opts.tracks && opts.tracks.length ? opts.tracks : defaultTracks(mood), mood);
  // 注意：bpm 不进种子，改速度只改快慢，不重掷旋律
  const rng = new Rng(`${seed}|${moodId}|${modeIdx}|${key.name}|${density}|${bars}|${spec.map(t => t.role + t.inst).join(',')}`);
  const title = opts.title || makeTitle(moodId, new Rng(`${seed}|title`));
  const rootMidi = key.midi;
  const secPerBeat = 60 / bpm;

  const sections = buildSections(bars);
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
  const secEnergy = { 引: 0.62, 起: 0.82, 承: 0.9, 转: 1.0, 合: 0.92, 展: 0.96, 尾: 0.7 };

  const leadReg = REGISTER[leadTrack.inst] || [3, 12];
  const contour = ['arch', 'asc', 'wave', 'desc'][rng.int(4)];
  const phraseMemo = {};

  for (const sec of sections) {
    const name = sec.name;
    const energy = secEnergy[name] ?? 0.85;

    if (name === '引') {
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
      for (const n of intro.filter(x => x.dur >= 1).slice(0, 3)) {
        push(leadTrack, { ...n, t: n.t + beatOf(sec.startBar), vel: n.vel * 0.6 });
      }
      continue;
    }

    if (name === '尾') {
      const last = sec.startBar + sec.bars - 1;
      const cad = rng.pick(stepsWithDegree(mode.tonic, leadReg[0] + 1, leadReg[1] - 1)) || leadReg[0] + 2;
      push(leadTrack, { t: beatOf(last), dur: 6, step: cad, vel: 0.72, cadence: true });
      if (bassTrack) push(bassTrack, { t: beatOf(last), dur: 6, step: cad - 5, vel: 0.5 });
      for (const pt of padTracks) push(pt, { t: beatOf(sec.startBar), dur: sec.bars * 4, step: cad - 5, vel: 0.35 });
      if (percTrack && (percTrack.inst === 'gong' || INSTRUMENTS[percTrack.inst]?.family === 'metal')) {
        push(percTrack, { t: beatOf(last), dur: 4, step: null, vel: 0.5 });
      }
      continue;
    }

    // 起承转合
    let phrase;
    if (name === '起') {
      phrase = genPhrase(rng, { bars: sec.bars, register: leadReg, kind: 'theme', density, mode, contour });
      phraseMemo.theme = phrase.map(n => ({ ...n }));
    } else if (name === '承') {
      const base = phraseMemo.theme || [];
      phrase = base.map(n => ({
        ...n, t: n.t + beatOf(sec.startBar),
        step: clamp(n.step + rng.pick([1, 2, 2, -1]), leadReg[0], leadReg[1]),
        vel: n.vel * 0.94,
      }));
    } else if (name === '转' || name === '展') {
      phrase = genPhrase(rng, {
        bars: sec.bars, register: [clamp(leadReg[0] + 2, 0, 12), leadReg[1] + 1],
        kind: 'contrast', density: Math.min(1, density * 1.18), mode, contour,
      });
    } else {
      const base = phraseMemo.theme || genPhrase(rng, { bars: sec.bars, register: leadReg, kind: 'theme', density, mode, contour });
      phrase = base.map(n => ({
        ...n, t: n.t + beatOf(sec.startBar),
        step: clamp(n.step + (n.cadence ? 0 : rng.pick([0, 0, 1])), leadReg[0], leadReg[1]),
      }));
    }

    // 倚音
    if (mood.ornaments > 0.3) {
      const extra = [];
      for (const n of phrase) {
        if (!n.grace && !n.aux && n.dur >= 1 && rng.chance(mood.ornaments * 0.3)) {
          extra.push({
            step: clamp(n.step + rng.pick([1, 1, -1, 2]), leadReg[0], leadReg[1]),
            t: n.t - 0.16, dur: 0.16, vel: 0.45, grace: true,
          });
        }
      }
      phrase = phrase.concat(extra);
    }
    for (const n of phrase) push(leadTrack, { ...n, vel: n.vel * energy });

    // 副旋律：与主旋律错开、落在下方三度内
    harmTracks.forEach((ht, idx) => {
      const reg = REGISTER[ht.inst] || [2, 10];
      const offset = (idx + 1) * 1.0;
      const strong = phrase.filter(n => !n.grace && n.dur >= 1);
      const picked = strong.filter((_, i) => i % (idx === 0 ? 2 : 3) === 0).slice(0, 3);
      for (const n of picked) {
        const step = clamp(n.step - rng.pick([2, 3, 2]), reg[0], reg[1]);
        push(ht, { t: n.t + offset, dur: Math.max(1, n.dur * 0.9), step, vel: n.vel * 0.5 * energy });
      }
      const cadStep = clamp((phrase.find(n => n.cadence)?.step ?? reg[0]) - 2, reg[0], reg[1]);
      push(ht, { t: beatOf(sec.startBar + sec.bars - 1) + 3, dur: 1, step: cadStep, vel: 0.42 });
    });

    // 铺底：每两小节一个和弦
    for (const pt of padTracks) {
      for (let b = 0; b < sec.bars; b += 2) {
        const deg = rng.pick([0, 3, 4, 1]);
        const step = clamp(deg - 5 + (REGISTER[pt.inst]?.[0] ?? 0), -6, 8);
        push(pt, { t: beatOf(sec.startBar + b), dur: 8, step, vel: 0.34 * energy });
        if (rng.chance(0.5)) push(pt, { t: beatOf(sec.startBar + b), dur: 8, step: step + 3, vel: 0.24 * energy });
      }
    }
  }

  // 低音：和声进行
  if (bassTrack) {
    const prog = rng.pick(mood.prog || [[0, 4, 1, 0]]);
    for (let b = 0; b < totalBars; b++) {
      const sec = barSec[b];
      if (sec === '引' || sec === '尾') continue;
      const chordDeg = prog[b % prog.length];
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

  // 人声化微扰
  for (const n of notes) {
    if (n.step == null) { n.t = Math.max(0, n.t + rng.gauss() * 0.01); continue; }
    n.t = Math.max(0, n.t + rng.gauss() * 0.013);
    n.dur = Math.max(0.12, n.dur * (1 + rng.gauss() * 0.05));
    n.vel = clamp(n.vel * (1 + rng.gauss() * 0.06), 0.15, 1);
  }
  notes.sort((a, b) => a.t - b.t);

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
      key: key.name, rootMidi, bpm, seed, density, bars: totalBars, beats: totalBeats,
      duration: totalBeats * secPerBeat,
      desc, engine: opts.engine || 'rule', reason: opts.reason || '',
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
