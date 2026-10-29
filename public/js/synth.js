// 纯 JS 合成引擎：每个音符渲染成一段单声道 Float32Array
// 不依赖 Web Audio，浏览器与 Node 都能跑，保证「试听 = 导出」同源
import { SR } from './theory.js';

/* ---------------- 基础 DSP ---------------- */
export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  lowpass(f, q = 0.707) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this;
  }
  highpass(f, q = 0.707) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this;
  }
  bandpass(f, q = 1) {
    const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    const a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0;
    this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;

function normalize(buf, target = 1) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
  if (peak > 1e-9) { const g = target / peak; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

// 指数包络：从 1 衰减到 ~0 的时间常数
function expDecay(t, tau) { return Math.exp(-t / tau); }

function fadeEdges(buf, inMs = 2, outMs = 30) {
  const a = Math.min(Math.floor(inMs * SR / 1000), buf.length >> 1);
  const b = Math.min(Math.floor(outMs * SR / 1000), buf.length >> 1);
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

/* ---------------- 各乐器 ---------------- */

// 古筝：Karplus-Strong 弦 + 琴体共振 + 指甲噪声
function guzheng(freq, dur, vel, rng) {
  const t60 = clamp(2.9 * Math.pow(220 / freq, 0.5), 0.9, 5.5);
  const tail = Math.min(t60 * 0.75, 3.2);
  const n = Math.floor((dur + tail) * SR);
  const out = new Float32Array(n);
  // 环形延迟线：延迟 D 采样；一阶平均滤波再贡献 0.5 采样延迟
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  // 激励：噪声 + 拨弦位置梳状滤波 + 高频滚降
  const pick = 0.13 + 0.2 * rng.next();
  const lp = new Biquad().lowpass(Math.min(5200, freq * 9), 0.7);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * pick));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.82;

  const rho = Math.pow(0.0015, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D;
    while (r < 0) r += M;
    const i0 = Math.floor(r) % M;
    const frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    const avg = (y + prev) * 0.5;
    prev = y;
    line[w] = avg * rho;
    out[i] = y;
    w = (w + 1) % M;
  }
  // 琴体：两个共振峰 + 低切
  const bp1 = new Biquad().bandpass(320, 1.2);
  const bp2 = new Biquad().bandpass(1050, 1.6);
  const hp = new Biquad().highpass(70, 0.7);
  for (let i = 0; i < n; i++) {
    const x = out[i];
    out[i] = hp.process(x) + bp1.process(x) * 0.22 + bp2.process(x) * 0.12;
  }
  // 指甲触弦噪声
  const clickN = Math.floor(0.012 * SR);
  const hpN = new Biquad().highpass(2600, 0.9);
  for (let i = 0; i < clickN; i++) {
    out[i] += hpN.process(rng.next() * 2 - 1) * 0.5 * Math.pow(1 - i / clickN, 3);
  }
  return fadeEdges(normalize(out), 1, 40);
}

// 笛：加法合成 + 颤音 + 气声
function dizi(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.45) * SR);
  const out = new Float32Array(n);
  const vibRate = 5.05 + rng.next() * 0.5;
  const vibDepth = 0.0035 + 0.0025 * clamp(dur / 2, 0, 1);
  const amp = new Float32Array(8);
  for (let h = 1; h <= 7; h++) amp[h] = 1 / Math.pow(h, 1.28) * (h === 2 ? 0.85 : 1);
  const phase = new Float32Array(8);
  const noise = new Biquad().bandpass(2400, 0.7);
  const hiss = new Biquad().highpass(3800, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.045);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.42) : 1;
    const env = atk * rel * (0.82 + 0.18 * Math.exp(-t / 0.25));
    const vibEnv = clamp((t - 0.12) / 0.4, 0, 1);
    const vib = 1 + vibDepth * vibEnv * Math.sin(TAU * vibRate * t) + 0.0012 * Math.sin(TAU * 0.7 * t);
    let s = 0;
    for (let h = 1; h <= 7; h++) {
      phase[h] += TAU * freq * h * vib / SR;
      s += Math.sin(phase[h]) * amp[h];
    }
    const br = noise.process(rng.next() * 2 - 1) * 0.05 * env;
    const ch = t < 0.03 ? hiss.process(rng.next() * 2 - 1) * 0.5 * (1 - t / 0.03) : 0;
    out[i] = (s * 0.42 + br + ch) * env;
  }
  return fadeEdges(normalize(out), 2, 60);
}

// 埙：近正弦，气息重，起音慢
function xun(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.7) * SR);
  const out = new Float32Array(n);
  const noise = new Biquad().lowpass(1400, 0.8);
  const ph = [0, 0, 0, 0];
  const amps = [1, 0.22, 0.08, 0.03];
  const vibRate = 4.3 + rng.next() * 0.6;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.11);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.6) : 1;
    const env = atk * rel * (0.85 + 0.15 * Math.exp(-t / 0.4));
    const vib = 1 + 0.005 * clamp((t - 0.25) / 0.6, 0, 1) * Math.sin(TAU * vibRate * t);
    let s = 0;
    for (let h = 0; h < 4; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += Math.sin(ph[h]) * amps[h]; }
    const br = noise.process(rng.next() * 2 - 1) * 0.035 * env;
    out[i] = Math.tanh((s * 0.6 + br) * env * 1.2) * 0.8;
  }
  return fadeEdges(normalize(out), 6, 80);
}

// 编钟：非谐分音 + 拍频
function bianzhong(freq, dur, vel, rng) {
  const tail = 2.6;
  const n = Math.floor((dur * 0.55 + tail) * SR);
  const out = new Float32Array(n);
  const partials = [
    [1.0, 1.0, 2.8], [2.02, 0.52, 2.1], [2.76, 0.44, 1.6],
    [5.41, 0.2, 0.9], [8.93, 0.11, 0.55], [13.34, 0.05, 0.3],
  ];
  const ph = partials.map(() => rng.next() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.004);
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, a, tau] = partials[k];
      ph[k] += TAU * freq * ratio * (1 + (k % 2 ? 0.0004 : -0.0003)) / SR;
      s += Math.sin(ph[k]) * a * Math.exp(-t / tau);
    }
    out[i] = s * atk;
  }
  // 敲击瞬态
  const hit = Math.floor(0.008 * SR);
  const bp = new Biquad().bandpass(3200, 1.2);
  for (let i = 0; i < hit; i++) out[i] += bp.process(rng.next() * 2 - 1) * 0.7 * (1 - i / hit);
  return fadeEdges(normalize(out), 1, 120);
}

// 弦乐垫：三路微失谐 + 慢起音
function pad(freq, dur, vel, rng) {
  const n = Math.floor((dur + 1.5) * SR);
  const out = new Float32Array(n);
  const det = [-5, 0, 6].map(c => Math.pow(2, c / 1200));
  const ph = det.map(() => rng.next() * TAU);
  const lfo = [0.17, 0.23, 0.31].map(f => rng.next() * TAU + f);
  const lp = new Biquad().lowpass(2600, 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.55);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 1.3) : 1;
    const env = atk * atk * rel;
    let s = 0;
    for (let v = 0; v < 3; v++) {
      const wob = 1 + 0.0022 * Math.sin(TAU * lfo[v] * t);
      let inner = 0;
      for (let h = 1; h <= 8; h++) inner += Math.sin(ph[v] * h) / Math.pow(h, 1.7);
      ph[v] += TAU * freq * det[v] * wob / SR;
      s += inner;
    }
    out[i] = Math.tanh(lp.process(s * 0.35) * 1.4) * 0.7 * env;
  }
  return fadeEdges(normalize(out), 20, 120);
}

// 低音：三角波式加法 + 拨弦起音
function bass(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.35) * SR);
  const out = new Float32Array(n);
  const ph = [0, 0, 0, 0];
  const lp = new Biquad().lowpass(900, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.014);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.3) : 1;
    const env = atk * rel * (0.6 + 0.4 * Math.exp(-t / 0.35));
    let s = 0;
    for (let h = 1; h <= 4; h++) { ph[h - 1] += TAU * freq * h / SR; s += Math.sin(ph[h - 1]) / (h * h); }
    s += Math.sin(ph[0]) * 0.5;
    out[i] = Math.tanh(lp.process(s) * 1.1) * env;
  }
  return fadeEdges(normalize(out), 1, 60);
}

// 鼓：低频下滑 + 噪声击打
function drum(freq, dur, vel, rng) {
  const n = Math.floor(0.55 * SR);
  const out = new Float32Array(n);
  const bp = new Biquad().bandpass(1800, 0.9);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 48 + 110 * Math.exp(-t / 0.045);
    phase += TAU * f / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.17);
    const click = i < 0.01 * SR ? bp.process(rng.next() * 2 - 1) * Math.exp(-t / 0.006) * 0.6 : 0;
    out[i] = (body + click) * (0.55 + 0.45 * vel);
  }
  return fadeEdges(normalize(out), 1, 30);
}

// 木鱼：窄带噪声 + 短促音高
function muyu(freq, dur, vel, rng) {
  const n = Math.floor(0.18 * SR);
  const out = new Float32Array(n);
  const bp = new Biquad().bandpass(1650, 9);
  const ph = 0;
  let p = ph;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const nz = bp.process(rng.next() * 2 - 1) * Math.exp(-t / 0.018);
    p += TAU * 980 / SR;
    const tone = Math.sin(p) * Math.exp(-t / 0.035) * 0.5;
    out[i] = (nz * 0.9 + tone) * (0.6 + 0.4 * vel);
  }
  return fadeEdges(normalize(out), 0.5, 15);
}

export const INSTRUMENTS = {
  guzheng: { name: '古筝', en: 'Guzheng', fn: guzheng, color: '#e7b45c', desc: '拨弦 · Karplus-Strong 弦模型', gain: 0.92, gm: 107 },
  dizi: { name: '笛', en: 'Dizi', fn: dizi, color: '#7fc8b0', desc: '吹管 · 加法合成 + 气声颤音', gain: 0.5, gm: 73 },
  xun: { name: '埙', en: 'Xun', fn: xun, color: '#c98f6d', desc: '陶埙 · 近正弦 + 慢起音', gain: 0.62, gm: 75 },
  bianzhong: { name: '编钟', en: 'Bianzhong', fn: bianzhong, color: '#9fb6d9', desc: '钟磬 · 非谐分音 + 拍频', gain: 0.55, gm: 14 },
  pad: { name: '弦垫', en: 'Pad', fn: pad, color: '#a99bf0', desc: '铺底 · 三路微失谐', gain: 0.42, gm: 48 },
  bass: { name: '低音', en: 'Bass', fn: bass, color: '#8d9aa8', desc: '低频 · 三角波加法', gain: 0.8, gm: 32 },
  drum: { name: '鼓', en: 'Drum', fn: drum, color: '#d98c8c', desc: '打击 · 下滑正弦 + 噪声', gain: 0.62, gm: 0 },
  muyu: { name: '木鱼', en: 'Muyu', fn: muyu, color: '#b9a27e', desc: '打击 · 窄带噪声', gain: 0.42, gm: 115 },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

// 渲染单个音符（含释放尾巴），返回归一化单声道缓冲
export function renderNote(id, freq, dur, vel = 0.8, rng) {
  const inst = INSTRUMENTS[id] || INSTRUMENTS.guzheng;
  const d = Math.max(0.04, dur);
  return inst.fn(freq, d, clamp(vel, 0.05, 1), rng);
}

// 试听：把一段五声音阶连成一串
export function renderDemo(id, rootMidi, rng, steps = [0, 1, 2, 3, 4]) {
  const dur = 0.5;
  const total = Math.floor((dur * steps.length + 2.2) * SR);
  const out = new Float32Array(total);
  let offset = 0;
  for (const st of steps) {
    const f = 440 * Math.pow(2, ((rootMidi + [0, 2, 4, 7, 9][((st % 5) + 5) % 5] + 12 * Math.floor(st / 5)) - 69) / 12);
    const buf = renderNote(id, f, dur, 0.85, rng);
    const start = Math.floor(offset * SR);
    for (let i = 0; i < buf.length && start + i < total; i++) out[start + i] += buf[i] * 0.7;
    offset += dur;
  }
  return normalize(out, 0.95);
}
