// 强校验：固定种子生成 → 下载 WAV → 在 Node 里逐音符核对频率/时值
// 用法：BASE=https://example.com/music/ node test/verify_export.mjs
import fs from 'node:fs';
import { launch, OUT_DIR, BASE } from './_browser.mjs';
import { compose } from '../public/js/composer.js';

const params = { seed: 424242, mood: 'jianghu', mode: 3, key: 'D', bpm: 90, density: 70, bars: 16 };
const hash = `#seed=${params.seed}&mood=${params.mood}&mode=${params.mode}&key=${params.key}`
  + `&bpm=${params.bpm}&density=${params.density}&bars=${params.bars}`;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(BASE + hash, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#title').textContent !== '还没有曲子', { timeout: 30000 });
await page.waitForTimeout(600);

const dlP = page.waitForEvent('download', { timeout: 60000 });
await page.click('#btnWav');
const dl = await dlP;
const wavPath = `${OUT_DIR}verify.wav`;
await dl.saveAs(wavPath);

const dl2P = page.waitForEvent('download', { timeout: 30000 });
await page.click('#btnMidi');
const dl2 = await dl2P;
const midPath = `${OUT_DIR}verify.mid`;
await dl2.saveAs(midPath);
await browser.close();

// ---- 解析 WAV ----
const buf = fs.readFileSync(wavPath);
const riff = buf.toString('ascii', 0, 4);
const ch = buf.readUInt16LE(22), rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
const dataLen = buf.readUInt32LE(40);
const nFrames = dataLen / (ch * bits / 8);
const L = new Float32Array(nFrames);
for (let i = 0; i < nFrames; i++) L[i] = buf.readInt16LE(44 + i * ch * 2) / 32768;
console.log(`WAV: ${riff} ch=${ch} rate=${rate} bits=${bits} frames=${nFrames} `
  + `时长=${(nFrames / rate).toFixed(2)}s 大小=${(buf.length / 1048576).toFixed(2)}MB`);

// ---- 用同一参数重算乐谱 ----
const piece = compose({
  mood: params.mood, mode: params.mode, key: params.key,
  bpm: params.bpm, density: params.density / 100, bars: params.bars, seed: params.seed,
});
console.log(`乐谱: 《${piece.meta.title}》 ${piece.meta.modeName} ${piece.meta.key} `
  + `${piece.meta.bpm}BPM ${piece.notes.length} 音符`);

const goertzel = (buf, from, len, freq, sr = 44100) => {
  const k = 2 * Math.cos(2 * Math.PI * freq / sr);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const s0 = buf[from + i] + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / len;
};

const secPerBeat = 60 / piece.meta.bpm;
const lead = piece.notes.filter(n => n.track === 'lead' && n.step != null && n.dur >= 0.75).slice(0, 12);
let hit = 0;
console.log('\n逐音符频率核对（主旋律）：');
for (const n of lead) {
  const t0 = Math.floor((n.t * secPerBeat + 0.06) * 44100);
  const len = Math.min(16384, Math.floor(n.dur * secPerBeat * 44100 * 0.7));
  const f = 440 * Math.pow(2, (n.midi - 69) / 12);
  const at = goertzel(L, t0, len, f);
  const off = goertzel(L, t0, len, f * 1.06);
  const off2 = goertzel(L, t0, len, f * 0.944);
  const okNote = at > off && at > off2;
  if (okNote) hit++;
  console.log(`  ${okNote ? '✓' : '✗'} t=${(n.t * secPerBeat).toFixed(2)}s midi=${n.midi} `
    + `${f.toFixed(1)}Hz 能量=${at.toFixed(4)} vs ${off.toFixed(4)}/${off2.toFixed(4)}`);
}

// ---- MIDI 事件数 ----
const mb = fs.readFileSync(midPath);
const ntrk = mb.readUInt16BE(10);
let notesOn = 0;
for (let i = 0; i < mb.length - 2; i++) if ((mb[i] & 0xf0) === 0x90 && mb[i + 2] > 0) notesOn++;
console.log(`\nMIDI: ${ntrk} 轨, ${notesOn} 个 note-on, ${mb.length} bytes`);

// ---- 段落能量曲线 ----
const bars = piece.meta.bars;
const perBar = Math.floor(4 * secPerBeat * rate);
let line = '';
for (let b = 0; b < bars; b++) {
  const s = b * perBar, e = Math.min(nFrames, s + perBar);
  let sum = 0;
  for (let i = s; i < e; i++) sum += L[i] * L[i];
  const rms = Math.sqrt(sum / Math.max(1, e - s));
  line += rms > 0.18 ? '█' : rms > 0.1 ? '▓' : rms > 0.04 ? '▒' : rms > 0.005 ? '░' : '·';
}
console.log(`能量曲线（每小节）: ${line}`);

const pass = hit >= lead.length * 0.8 && nFrames / rate > piece.meta.duration * 0.95 && notesOn > 20;
console.log(`\n${pass ? '✅ 音频与乐谱一致' : '❌ 存在偏差'}（命中 ${hit}/${lead.length}）`);
process.exit(pass ? 0 : 1);
