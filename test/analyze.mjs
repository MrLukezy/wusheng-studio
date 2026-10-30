// Node 侧自检：音高、时值、编曲结构、WAV 头
import { compose } from '../public/js/composer.js';
import { renderNote, renderAmbience, INSTRUMENTS } from '../public/js/synth.js';
import { Rng } from '../public/js/rng.js';
import { encodeWav } from '../public/js/wav.js';
import { encodeMidi } from '../public/js/midi.js';
import { stepToMidi, SR } from '../public/js/theory.js';

const goertzel = (buf, freq, sr = SR) => {
  const k = 2 * Math.cos(2 * Math.PI * freq / sr);
  let s1 = 0, s2 = 0;
  const n = Math.min(buf.length, sr * 0.5);
  for (let i = 0; i < n; i++) { const s0 = buf[i] + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
};
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); };
const peak = b => { let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

console.log('\n[1] 音高校验（Goertzel 主频检测）');
for (const id of Object.keys(INSTRUMENTS)) {
  if (!INSTRUMENTS[id].fn) continue; // 氛围层另测
  const midi = 60; // C4
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const buf = renderNote(id, f, 0.8, 0.9, new Rng(42));
  const at = goertzel(buf, f), up = goertzel(buf, f * 1.0595), down = goertzel(buf, f * 0.9439);
  const dur = (buf.length / SR).toFixed(2);
  if (['drum', 'muyu', 'gong', 'paigu', 'bangzi', 'pengling'].includes(id)) {
    // 无音高打击乐：只查能量与衰减
    const half = Math.floor(buf.length / 2);
    ok(peak(buf) > 0.5 && peak(buf.slice(half)) < peak(buf.slice(0, half)) * 0.6,
      `${INSTRUMENTS[id].name.padEnd(4)} 瞬态与衰减正常`, `peak=${peak(buf).toFixed(2)}, ${dur}s`);
    continue;
  }
  ok(at > up && at > down, `${INSTRUMENTS[id].name.padEnd(4)} 基频占优`, `${at.toFixed(4)} vs ${up.toFixed(4)}/${down.toFixed(4)}, ${dur}s`);
}

console.log('\n[1b] 氛围层');
for (const id of ['rain', 'wind']) {
  const tex = renderAmbience(id, 3, new Rng(3));
  let p = 0; for (const v of tex) p = Math.max(p, Math.abs(v));
  ok(tex.length === 3 * 44100 && p > 0.2 && p <= 1, `${id} 纹理`, `${(tex.length / 44100).toFixed(1)}s peak=${p.toFixed(2)}`);
}

console.log('\n[2] 五声跨八度映射');
const C4 = 60;
const expect = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
const got = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => stepToMidi(s, C4));
ok(JSON.stringify(got) === JSON.stringify(expect), '宫商角徵羽跨八度', got.join(','));

console.log('\n[3] 编曲结构');
for (const mood of ['qingya', 'huankuai', 'cangliang', 'chanyi', 'jianghu', 'xiandai']) {
  const p = compose({ mood, mode: 3, key: 'D', bpm: 80, density: 0.6, length: 'normal', seed: 12345 });
  const midis = p.notes.filter(n => n.step != null).map(n => n.midi);
  const bad = p.notes.filter(n => !isFinite(n.t) || !isFinite(n.dur) || n.dur <= 0 || (n.step != null && (!isFinite(n.midi) || n.midi < 30 || n.midi > 96)));
  const barsOk = p.sections.reduce((a, s) => a + s.bars, 0) === p.meta.bars;
  ok(bad.length === 0 && p.notes.length > 40 && barsOk,
    `${p.meta.moodName} 《${p.meta.title}》`,
    `${p.notes.length} 音符, ${p.meta.bars} 小节, ${p.meta.duration.toFixed(1)}s, 音域 ${Math.min(...midis)}-${Math.max(...midis)}, 轨 ${p.tracks.map(t => t.id).join('/')}`);
  // 五声约束：所有音高都应落在五声集合内
  const pcs = new Set([0, 2, 4, 7, 9]);
  const offScale = midis.filter(m => !pcs.has(((m - p.meta.rootMidi) % 12 + 12) % 12));
  ok(offScale.length === 0, '  全部音符在五声内', offScale.length ? `越界 ${offScale.length}` : '');
}

console.log('\n[4] 同一 seed 可复现');
const a = compose({ mood: 'qingya', mode: 1, key: 'A', bpm: 70, density: 0.5, length: 'short', seed: 777 });
const b = compose({ mood: 'qingya', mode: 1, key: 'A', bpm: 70, density: 0.5, length: 'short', seed: 777 });
const c = compose({ mood: 'qingya', mode: 1, key: 'A', bpm: 70, density: 0.5, length: 'short', seed: 778 });
ok(JSON.stringify(a.notes) === JSON.stringify(b.notes), 'seed 777 两次一致');
ok(JSON.stringify(a.notes) !== JSON.stringify(c.notes), 'seed 778 产生不同结果');

console.log('\n[5] WAV / MIDI 编码');
const L = new Float32Array(4410), R = new Float32Array(4410);
for (let i = 0; i < L.length; i++) { L[i] = Math.sin(i / 20) * 0.5; R[i] = -L[i]; }
const wav = encodeWav([L, R], 44100);
const dv = new DataView(wav);
const magic = String.fromCharCode(...new Uint8Array(wav, 0, 4));
ok(magic === 'RIFF' && dv.getUint16(22, true) === 2 && dv.getUint32(24, true) === 44100, 'WAV 头合法', `${wav.byteLength} bytes`);
const mid = encodeMidi(a);
ok(mid.length > 100 && String.fromCharCode(...mid.slice(0, 4)) === 'MThd', 'MIDI 头合法', `${mid.length} bytes`);

console.log('\n[6] 渲染真实片段并检查电平');
const piece = compose({ mood: 'jianghu', mode: 0, key: 'G', bpm: 92, density: 0.7, length: 'short', seed: 2024 });
const secPerBeat = 60 / piece.meta.bpm;
const total = Math.ceil((piece.meta.duration + 3) * SR);
const mix = new Float32Array(total);
const rng = new Rng('mix');
for (const n of piece.notes) {
  const f = n.midi > 0 ? 440 * Math.pow(2, (n.midi - 69) / 12) : 110;
  const buf = renderNote(n.inst, f, n.dur * secPerBeat, n.vel, rng);
  const start = Math.round(n.t * secPerBeat * SR);
  const g = n.vel * (INSTRUMENTS[n.inst]?.gain ?? 0.7) * 0.62;
  for (let i = 0; i < buf.length && start + i < total; i++) mix[start + i] += buf[i] * g;
}
ok(rms(mix) > 0.01, '混音 RMS 正常', `rms=${rms(mix).toFixed(4)} peak=${peak(mix).toFixed(3)} 时长=${(total / SR).toFixed(1)}s`);
ok(peak(mix) < 4, '未出现爆音级峰值', `peak=${peak(mix).toFixed(3)}`);

console.log(`\n${fails === 0 ? '✅ 全部通过' : `❌ ${fails} 项失败`}\n`);
process.exit(fails ? 1 : 0);
