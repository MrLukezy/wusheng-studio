// AI 编曲：动机生成 → 模进/变奏 → 配器 → 人声化微扰
// 规则驱动的生成式算法（非神经网络），同一 seed 结果可复现
import { Rng } from './rng.js';
import { MODES, KEYS, MOOD_BY_ID, makeTitle, stepToMidi, stepDegree } from './theory.js';

const CN_NAME = { guzheng: '古筝', dizi: '笛', xun: '埙', bianzhong: '编钟', pad: '弦垫', bass: '低音', drum: '鼓', muyu: '木鱼' };

const TRACKS = {
  lead: { name: '主旋律', color: '#e7b45c', gain: 0.95, pan: -0.06 },
  harm: { name: '副旋律', color: '#7fc8b0', gain: 0.62, pan: 0.18 },
  pad: { name: '铺底', color: '#a99bf0', gain: 0.34, pan: 0.0 },
  bass: { name: '低音', color: '#9dabbb', gain: 0.58, pan: -0.1 },
  perc: { name: '打击', color: '#d98c8c', gain: 0.55, pan: 0.12 },
};

const LENGTHS = {
  short: { name: '短曲', sections: [['引', 2], ['起', 4], ['合', 4], ['尾', 2]] },
  normal: { name: '标准', sections: [['引', 2], ['起', 4], ['承', 4], ['转', 4], ['合', 4], ['尾', 2]] },
  long: { name: '长曲', sections: [['引', 2], ['起', 4], ['承', 4], ['转', 4], ['展', 4], ['合', 4], ['尾', 2]] },
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// 依据情绪与密度给出一小节的节奏骨架
function barRhythm(rng, density, grid) {
  const onsets = [];
  for (let b = 0; b < 4 - 1e-9; b += grid) {
    const accent = b === 0 ? 1.7 : b === 2 ? 1.35 : b === 1 || b === 3 ? 1.1 : 0.85;
    if (rng.chance(density * accent)) onsets.push(+b.toFixed(2));
  }
  if (!onsets.length) onsets.push(rng.chance(0.5) ? 0 : 2);
  return onsets;
}

function pickModeTonicStep(tonic, lo, hi) {
  const out = [];
  for (let s = lo; s <= hi; s++) if (stepDegree(s) === tonic) out.push(s);
  return out;
}

export function compose(opts = {}) {
  const moodId = opts.mood || 'qingya';
  const mood = MOOD_BY_ID[moodId] || MOOD_BY_ID.qingya;
  const modeIdx = opts.mode ?? 0;
  const mode = MODES[modeIdx] || MODES[0];
  const key = KEYS.find(k => k.name === (opts.key || 'C')) || KEYS[0];
  const lengthId = opts.length || 'normal';
  const len = LENGTHS[lengthId] || LENGTHS.normal;
  const bpm = clamp(Math.round(opts.bpm || mood.bpm), 40, 200);
  const density = clamp(opts.density ?? mood.density, 0.1, 1);
  const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
  const rng = new Rng(`${seed}|${moodId}|${modeIdx}|${key.name}|${bpm}|${density}`);
  const title = opts.title || makeTitle(moodId, new Rng(`${seed}|title`));

  const rootMidi = key.midi;
  const notes = [];
  const sections = [];
  const barSec = [];

  // ---- 段落 ----
  let bar = 0;
  for (const [name, bars] of len.sections) {
    sections.push({ name, startBar: bar, bars });
    for (let i = 0; i < bars; i++) barSec.push(name);
    bar += bars;
  }
  const totalBars = bar;
  const beatOfBar = b => b * 4;

  // ---- 配器 ----
  const pal = mood.palette;
  const leadInst = pal[0];
  const harmInst = pal.find(p => p !== leadInst && p !== 'bass' && p !== 'drum') || 'dizi';
  const usePad = pal.includes('pad');
  const percInst = pal.includes('drum') ? 'drum' : (moodId === 'chanyi' ? 'muyu' : null);

  // ---- 旋律动机 ----
  const grid = density > 0.62 ? 0.5 : 1;
  const lo = 3, hi = 12;
  const tonicSteps = pickModeTonicStep(mode.tonic, lo, hi);
  const fifthSteps = pickModeTonicStep((mode.tonic + 3) % 5, lo, hi);

  const contour = ['arch', 'asc', 'wave', 'desc'][rng.int(4)];

  function contourBias(p) { // p: 0..1 段内进度
    if (contour === 'arch') return Math.sin(Math.PI * p) * 2 - 1;
    if (contour === 'asc') return p * 2 - 1;
    if (contour === 'desc') return 1 - p * 2;
    return Math.sin(Math.PI * 2 * p) * 0.8;
  }

  function genPhrase(startBar, bars, register, kind) {
    const ev = [];
    let s = rng.pick(tonicSteps.filter(x => x >= 5 && x <= 10)) || 7;
    if (kind === 'contrast') s = clamp(s + rng.pick([2, 3, -2]), lo, hi);
    const notesPerBar = [];
    for (let b = 0; b < bars; b++) {
      const onsets = barRhythm(rng, density * (kind === 'intro' ? 0.5 : 1), grid);
      notesPerBar.push(onsets);
    }
    for (let b = 0; b < bars; b++) {
      const onsets = notesPerBar[b];
      for (let i = 0; i < onsets.length; i++) {
        const o = onsets[i];
        const next = i + 1 < onsets.length ? onsets[i + 1] : 4;
        let dur = Math.max(0.25, next - o);
        if (dur > 2.5) dur = rng.pick([1.5, 2, 2.5]);
        const progress = (b + o / 4) / bars;
        const target = 7 + contourBias(progress) * (register * 2.2);
        const dir = s < target ? 1 : -1;
        const move = rng.weighted([
          { w: 4, v: dir * 1 }, { w: 3, v: dir * 2 }, { w: 1.4, v: -dir * 1 },
          { w: 1, v: dir * 3 }, { w: 0.6, v: 0 }, { w: 0.8, v: -dir * 2 },
        ]).v;
        s = clamp(s + move, lo, hi);
        // 大跳之后回填
        if (Math.abs(move) >= 3 && rng.chance(0.65)) {
          const back = s - Math.sign(move) * 1;
          ev.push({ step: clamp(back, lo, hi), t: beatOfBar(startBar + b) + o, dur: Math.min(0.5, dur), vel: 0.55, grace: false });
        }
        const vel = clamp(0.72 + (o === 0 ? 0.12 : 0) + rng.gauss() * 0.07, 0.35, 1);
        ev.push({ step: s, t: beatOfBar(startBar + b) + o, dur, vel, grace: false });
      }
    }
    // 句尾落音（起承转合用「合尾」规则）
    const lastBar = startBar + bars - 1;
    const cand = kind === 'cadence' ? tonicSteps : fifthSteps;
    const cad = rng.pick(cand.filter(x => x >= 5 && x <= 11)) || tonicSteps[0];
    ev.push({ step: cad, t: beatOfBar(lastBar) + 2, dur: 2, vel: 0.8, grace: false, cadence: true });
    return ev;
  }

  // 依段落生成，动机在「承」「合」中复用
  const phraseMemo = {};
  for (const sec of sections) {
    const name = sec.name;
    if (name === '引') {
      // 引子：留白，仅铺底与零星点缀
      if (usePad) {
        for (let b = 0; b < sec.bars; b++) {
          const step = tonicSteps[0] - 5;
          notes.push({ t: beatOfBar(sec.startBar + b), dur: 4, step, midi: stepToMidi(step, rootMidi), vel: 0.5, inst: 'pad', track: 'pad' });
        }
      }
      const introNotes = genPhrase(sec.startBar, sec.bars, 0.45, 'intro').filter(n => n.dur >= 1);
      for (const n of introNotes.slice(0, 3)) {
        notes.push({ ...n, midi: stepToMidi(n.step, rootMidi), inst: leadInst, track: 'lead', vel: n.vel * 0.7 });
      }
      continue;
    }
    if (name === '尾') {
      const last = sec.startBar + sec.bars - 1;
      const cad = rng.pick(tonicSteps.filter(x => x >= 4 && x <= 9)) || 5;
      notes.push({ t: beatOfBar(last), dur: 6, step: cad, midi: stepToMidi(cad, rootMidi), vel: 0.72, inst: leadInst, track: 'lead' });
      notes.push({ t: beatOfBar(last), dur: 6, step: cad - 5, midi: stepToMidi(cad - 5, rootMidi), vel: 0.5, inst: 'bass', track: 'bass' });
      if (usePad) notes.push({ t: beatOfBar(sec.startBar), dur: sec.bars * 4, step: cad - 5, midi: stepToMidi(cad - 5, rootMidi), vel: 0.4, inst: 'pad', track: 'pad' });
      continue;
    }
    // 起承转合
    let phrase;
    if (name === '起') {
      phrase = genPhrase(sec.startBar, sec.bars, 1, 'theme');
      phraseMemo.theme = phrase.map(n => ({ ...n, t: n.t - beatOfBar(sec.startBar) }));
    } else if (name === '承') {
      phrase = phraseMemo.theme.map(n => ({ ...n, t: n.t + beatOfBar(sec.startBar), step: clamp(n.step + rng.pick([1, 2, 2, -1]), lo, hi) }));
      phrase = phrase.map(n => ({ ...n, vel: n.vel * 0.92 }));
    } else if (name === '转' || name === '展') {
      phrase = genPhrase(sec.startBar, sec.bars, 1.6, 'contrast');
    } else { // 合
      phrase = phraseMemo.theme.map(n => ({ ...n, t: n.t + beatOfBar(sec.startBar), step: clamp(n.step + (n.cadence ? 0 : rng.pick([0, 0, 1])), lo, hi) }));
    }
    // 装饰音
    if (mood.ornaments > 0.3) {
      const extra = [];
      for (const n of phrase) {
        if (!n.grace && n.dur >= 1 && rng.chance(mood.ornaments * 0.35)) {
          const g = clamp(n.step + rng.pick([1, 1, -1, 2]), lo, hi);
          extra.push({ step: g, t: n.t - 0.16, dur: 0.16, vel: 0.5, grace: true });
        }
      }
      phrase = phrase.concat(extra);
    }
    for (const n of phrase) {
      notes.push({ ...n, midi: stepToMidi(n.step, rootMidi), inst: leadInst, track: 'lead' });
    }
    // 副旋律：在句尾做应答，或与主旋律错开
    const resp = genPhrase(sec.startBar, sec.bars, 0.8, 'response').filter(n => n.cadence || n.dur >= 1.5);
    for (const n of resp.slice(0, 3)) {
      if (rng.chance(0.75)) {
        notes.push({ ...n, step: clamp(n.step - 2, lo - 2, hi), midi: stepToMidi(clamp(n.step - 2, lo - 2, hi), rootMidi), inst: harmInst, track: 'harm', vel: n.vel * 0.55 });
      }
    }
  }

  // ---- 低音：和声进行 ----
  const prog = rng.pick(mood.prog);
  for (let b = 0; b < totalBars; b++) {
    const sec = barSec[b];
    if (sec === '引' || sec === '尾') continue;
    const chordDeg = prog[b % prog.length];
    const bassStep = chordDeg - 5; // 低一个八度的对应音级
    const beat = beatOfBar(b);
    const vel = 0.62 + (b % 2 === 0 ? 0.08 : 0);
    notes.push({ t: beat, dur: 3.6, step: bassStep, midi: stepToMidi(bassStep, rootMidi), vel, inst: 'bass', track: 'bass' });
    if (density > 0.55 && b % 2 === 1) {
      notes.push({ t: beat + 2, dur: 1.6, step: bassStep + 2, midi: stepToMidi(bassStep + 2, rootMidi), vel: 0.45, inst: 'bass', track: 'bass' });
    }
    if (usePad && b % 2 === 0) {
      notes.push({ t: beat, dur: 7.6, step: chordDeg, midi: stepToMidi(chordDeg, rootMidi), vel: 0.42, inst: 'pad', track: 'pad' });
    }
  }

  // ---- 打击 ----
  if (percInst) {
    for (let b = 0; b < totalBars; b++) {
      const sec = barSec[b];
      if (sec === '引' || sec === '尾') continue;
      const beat = beatOfBar(b);
      const d = mood.drums;
      const pattern = [];
      if (rng.chance(d * 0.95)) pattern.push([0, 0.9]);
      if (rng.chance(d * 0.45)) pattern.push([2, 0.55]);
      for (let k = 0; k < 4; k++) {
        if (rng.chance(d * 0.3)) pattern.push([k + 0.5, 0.32 + rng.next() * 0.15]);
      }
      if (sec === '转' && b % 4 === 3) {
        pattern.push([3.25, 0.5], [3.5, 0.6], [3.75, 0.75]);
      }
      for (const [pos, v] of pattern) {
        const useMuyu = percInst === 'muyu' || (pos % 1 !== 0 && rng.chance(0.55));
        notes.push({
          t: beat + pos, dur: 0.4, step: null, midi: 0,
          vel: clamp(v, 0.2, 1), inst: useMuyu ? 'muyu' : 'drum', track: 'perc',
        });
      }
    }
  }

  // ---- 人声化：时值/力度微扰 ----
  for (const n of notes) {
    if (n.track === 'perc') {
      n.t = Math.max(0, n.t + rng.gauss() * 0.012);
      continue;
    }
    n.t = Math.max(0, n.t + rng.gauss() * 0.014);
    n.dur = Math.max(0.12, n.dur * (1 + rng.gauss() * 0.05));
    n.vel = clamp(n.vel * (1 + rng.gauss() * 0.06), 0.2, 1);
  }

  notes.sort((a, b) => a.t - b.t);
  const totalBeats = totalBars * 4;
  const secDuration = 60 / bpm;

  const trackList = Object.entries(TRACKS)
    .filter(([id]) => notes.some(n => n.track === id))
    .map(([id, t]) => ({ id, ...t }));

  const percUsed = notes.some(n => n.track === 'perc');
  const desc = [
    `${mode.name}（主音${key.name}，${mode.mood}）`,
    `曲式 ${len.sections.map(([n, b]) => `${n}${b}小节`).join(' · ')}`,
    `织体 ${CN_NAME[leadInst]}主奏 + ${CN_NAME[harmInst]}应答${usePad ? ' + 弦垫' : ''}${percUsed ? ' + ' + CN_NAME[percInst] : ''}`,
  ].join(' ｜ ');

  return {
    meta: {
      title, mood: moodId, moodName: mood.name, mode: modeIdx, modeName: mode.name,
      key: key.name, rootMidi, bpm, seed, density, lengthId, lengthName: len.name,
      bars: totalBars, beats: totalBeats, duration: totalBeats * secDuration,
      desc, palette: [leadInst, harmInst, usePad ? 'pad' : null, percInst].filter(Boolean),
    },
    notes,
    sections: sections.map(s => ({ ...s, startBeat: s.startBar * 4 })),
    tracks: trackList,
    trackDefs: TRACKS,
  };
}
