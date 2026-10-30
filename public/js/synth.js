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

// 查表正弦：比 Math.sin 快数倍，热点内循环用它
const SIN_N = 2048;
const SIN_TAB = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_TAB[i] = Math.sin(TAU * i / SIN_N);
const SIN_SCALE = SIN_N / TAU;
function fsin(x) {
  let p = (x * SIN_SCALE) % SIN_N;
  if (p < 0) p += SIN_N;
  const i = p | 0;
  const f = p - i;
  return SIN_TAB[i] + (SIN_TAB[i + 1] - SIN_TAB[i]) * f;
}

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
      s += fsin(phase[h]) * amp[h];
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
    for (let h = 0; h < 4; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += fsin(ph[h]) * amps[h]; }
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
      s += fsin(ph[k]) * a * Math.exp(-t / tau);
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
  const PAD_AMP = [0, 1, 0.308, 0.148, 0.087, 0.058, 0.042];
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
      for (let h = 1; h <= 6; h++) inner += fsin(ph[v] * h) * PAD_AMP[h];
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
    for (let h = 1; h <= 4; h++) { ph[h - 1] += TAU * freq * h / SR; s += fsin(ph[h - 1]) / (h * h); }
    s += fsin(ph[0]) * 0.5;
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
    const body = fsin(phase) * Math.exp(-t / 0.17);
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
    const tone = fsin(p) * Math.exp(-t / 0.035) * 0.5;
    out[i] = (nz * 0.9 + tone) * (0.6 + 0.4 * vel);
  }
  return fadeEdges(normalize(out), 0.5, 15);
}


/* ---------------- 第二批：拉弦 / 弹拨 / 吹管 / 打击 / 氛围 ---------------- */

// 二胡：锯齿波族 + 弓噪 + 鼻音共鸣 + 深颤音
function erhu(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.55) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(14);
  const vibRate = 5.2 + rng.next() * 0.6;
  const noise = new Biquad().bandpass(1800, 0.8);
  const body1 = new Biquad().bandpass(520, 1.6);
  const body2 = new Biquad().bandpass(1250, 2.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.085);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.5) : 1;
    const env = atk * rel;
    const vibEnv = clamp((t - 0.18) / 0.5, 0, 1);
    const vib = 1 + 0.008 * vibEnv * Math.sin(TAU * vibRate * t)
      + 0.0025 * Math.sin(TAU * (vibRate * 0.5) * t + 1.1);
    let s = 0;
    for (let h = 1; h <= 13; h++) {
      ph[h] += TAU * freq * h * vib / SR;
      s += fsin(ph[h]) / (h * 0.9 + 0.6);
    }
    const bow = noise.process(rng.next() * 2 - 1) * (0.05 + 0.03 * Math.sin(TAU * 7.3 * t));
    const x = s * 0.3 + bow;
    out[i] = (x + body1.process(x) * 0.5 + body2.process(x) * 0.3) * env * 0.6;
  }
  return fadeEdges(normalize(out), 8, 80);
}

// 琵琶：明亮拨弦（短促 + 强起音 + 轮指感）
function pipa(freq, dur, vel, rng) {
  const t60 = clamp(1.6 * Math.pow(300 / freq, 0.35), 0.5, 2.2);
  const n = Math.floor((dur * 0.7 + t60) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(9000, freq * 14), 0.6);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.09));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.9;
  const rho = Math.pow(0.002, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const hp = new Biquad().highpass(140, 0.7);
  const click = Math.floor(0.008 * SR);
  const bp = new Biquad().bandpass(3800, 1.1);
  for (let i = 0; i < n; i++) out[i] = hp.process(out[i]);
  for (let i = 0; i < click; i++) out[i] += bp.process(rng.next() * 2 - 1) * 0.55 * (1 - i / click);
  return fadeEdges(normalize(out), 1, 40);
}

// 箫：低谐波 + 重气声 + 慢起音
function xiao(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.6) * SR);
  const out = new Float32Array(n);
  const ph = [0, 0, 0, 0, 0];
  const amps = [1, 0.32, 0.12, 0.05, 0.02];
  const noise = new Biquad().bandpass(1500, 0.6);
  const vibRate = 4.6 + rng.next() * 0.4;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.07);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.55) : 1;
    const env = atk * rel * (0.8 + 0.2 * Math.exp(-t / 0.3));
    const vib = 1 + 0.004 * clamp((t - 0.2) / 0.5, 0, 1) * Math.sin(TAU * vibRate * t);
    let s = 0;
    for (let h = 0; h < 5; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += fsin(ph[h]) * amps[h]; }
    const br = noise.process(rng.next() * 2 - 1) * 0.09;
    out[i] = (s * 0.5 + br) * env;
  }
  return fadeEdges(normalize(out), 5, 70);
}

// 古琴：暗拨弦 + 长余音 + 低频琴体
function guqin(freq, dur, vel, rng) {
  const t60 = clamp(4.2 * Math.pow(160 / freq, 0.35), 1.6, 7);
  const n = Math.floor((dur + Math.min(t60 * 0.8, 4.5)) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(2600, freq * 6), 0.7);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.22));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.7;
  const rho = Math.pow(0.0012, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const body = new Biquad().bandpass(110, 1.4);
  const hp = new Biquad().highpass(50, 0.7);
  for (let i = 0; i < n; i++) { const x = hp.process(out[i]); out[i] = x + body.process(x) * 0.35; }
  return fadeEdges(normalize(out), 2, 90);
}

// 扬琴：击弦，金属泛音，衰减快
function yangqin(freq, dur, vel, rng) {
  const n = Math.floor((Math.min(dur, 1.2) + 1.1) * SR);
  const out = new Float32Array(n);
  const partials = [[1, 1, 1.5], [2.01, 0.5, 1.0], [3.02, 0.28, 0.6], [4.2, 0.16, 0.4], [5.9, 0.08, 0.25]];
  const ph = partials.map(() => rng.next() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.002);
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, a, tau] = partials[k];
      ph[k] += TAU * freq * ratio / SR;
      s += fsin(ph[k]) * a * Math.exp(-t / tau);
    }
    out[i] = s * atk;
  }
  const hit = Math.floor(0.006 * SR);
  const bp = new Biquad().bandpass(2600, 1.2);
  for (let i = 0; i < hit; i++) out[i] += bp.process(rng.next() * 2 - 1) * 0.5 * (1 - i / hit);
  return fadeEdges(normalize(out), 1, 50);
}

// 唢呐：簧片方波族 + 鼻音共振 + 强颤音
function suona(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.35) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(16);
  const form = new Biquad().bandpass(1600, 1.1);
  const vibRate = 6.1 + rng.next() * 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.03);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.3) : 1;
    const env = atk * rel * (0.85 + 0.15 * Math.exp(-t / 0.2));
    const vib = 1 + 0.009 * clamp((t - 0.12) / 0.35, 0, 1) * Math.sin(TAU * vibRate * t);
    let s = 0;
    for (let h = 1; h <= 15; h += 2) {
      ph[h] += TAU * freq * h * vib / SR;
      s += fsin(ph[h]) / h;
    }
    const x = form.process(s);
    out[i] = Math.tanh((s * 0.55 + x * 0.6) * 1.6) * env * 0.8;
  }
  return fadeEdges(normalize(out), 2, 40);
}

// 锣：低频非谐分音 + 噪声铺开 + 长衰减
function gong(freq, dur, vel, rng) {
  const n = Math.floor(4.2 * SR);
  const out = new Float32Array(n);
  const partials = [[1, 1, 2.6], [1.48, 0.6, 2.2], [2.13, 0.45, 1.7], [2.92, 0.3, 1.2], [4.12, 0.18, 0.8], [6.3, 0.1, 0.5]];
  const base = Math.max(70, freq * 0.5);
  const ph = partials.map(() => rng.next() * TAU);
  const wash = new Biquad().bandpass(2200, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.006);
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, a, tau] = partials[k];
      ph[k] += TAU * base * ratio / SR;
      s += fsin(ph[k]) * a * Math.exp(-t / tau);
    }
    const nz = wash.process(rng.next() * 2 - 1) * Math.exp(-t / 0.35) * 0.5;
    out[i] = (s * 0.8 + nz) * atk;
  }
  return fadeEdges(normalize(out), 1, 200);
}

/* ---------------- 氛围层：连续纹理，不是「音符」 ---------------- */

// 雨：低通噪声 + 随机雨滴
function rain(seconds, rng) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const lp = new Biquad().lowpass(4200, 0.6);
  const hp = new Biquad().highpass(300, 0.7);
  let droplet = 0, dropAmp = 0, dropF = 0;
  const bp = new Biquad();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (t > droplet) {
      droplet = t + 0.02 + rng.next() * 0.18;
      dropAmp = 0.05 + rng.next() * 0.18;
      dropF = 1800 + rng.next() * 4200;
      bp.bandpass(dropF, 6);
      dropAmp *= 0.6 + 0.4 * Math.sin(t * 0.7);
    }
    const nz = rng.next() * 2 - 1;
    const bed = hp.process(lp.process(nz)) * 0.10;
    const dr = bp.process(nz) * dropAmp * 0.9;
    const swell = 0.85 + 0.15 * Math.sin(TAU * 0.08 * t);
    out[i] = (bed + dr) * swell;
  }
  return fadeEdges(normalize(out, 0.5), 600, 900);
}

// 风：带通噪声 + 缓慢阵风
function wind(seconds, rng) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const bp = new Biquad();
  const lp = new Biquad().lowpass(900, 0.7);
  let lpS = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const gust = 0.55 + 0.45 * Math.sin(TAU * 0.045 * t + Math.sin(TAU * 0.013 * t) * 2.2);
    const f = 260 + 420 * (0.5 + 0.5 * Math.sin(TAU * 0.03 * t + 1.7));
    if (i % 512 === 0) bp.bandpass(f, 0.9);
    const nz = bp.process(rng.next() * 2 - 1);
    lpS = lpS * 0.9 + nz * 0.1;
    out[i] = (nz * 0.6 + lpS * 2.2) * gust;
  }
  return fadeEdges(normalize(out, 0.45), 1200, 1500);
}

export function renderAmbience(id, seconds, rng) {
  if (id === 'rain') return rain(seconds, rng);
  if (id === 'wind') return wind(seconds, rng);
  return new Float32Array(Math.floor(seconds * SR));
}


/* ---------------- 第三批：传统乐器扩充 ---------------- */

// 笙：簧片自由振动，奇数+偶数谐波混合，带轻微拍频
function sheng(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.5) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(10);
  const amps = [1, 0.55, 0.62, 0.22, 0.3, 0.12, 0.14, 0.06, 0.05, 0.03];
  const beat = 1 + 0.0025 * (rng.next() - 0.5);
  const noise = new Biquad().bandpass(2200, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.055);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.42) : 1;
    const env = atk * rel * (0.85 + 0.15 * Math.exp(-t / 0.3));
    const vib = 1 + 0.0035 * clamp((t - 0.2) / 0.6, 0, 1) * fsin(TAU * 5.4 * t);
    let s = 0;
    for (let h = 1; h <= 10; h++) {
      ph[h - 1] += TAU * freq * h * vib * (h % 2 ? beat : 1) / SR;
      s += fsin(ph[h - 1]) * amps[h - 1];
    }
    const br = noise.process(rng.next() * 2 - 1) * 0.03;
    out[i] = (s * 0.28 + br) * env;
  }
  return fadeEdges(normalize(out), 4, 60);
}

// 葫芦丝：温暖圆润，低谐波+柔起音+宽颤音
function hulusi(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.4) * SR);
  const out = new Float32Array(n);
  const ph = [0, 0, 0, 0, 0, 0];
  const amps = [1, 0.4, 0.2, 0.1, 0.04, 0.02];
  const noise = new Biquad().lowpass(1800, 0.7);
  const vibRate = 4.2 + rng.next() * 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.06);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.38) : 1;
    const env = atk * rel * (0.9 + 0.1 * Math.exp(-t / 0.35));
    const vib = 1 + 0.006 * clamp((t - 0.15) / 0.4, 0, 1) * fsin(TAU * vibRate * t);
    let s = 0;
    for (let h = 0; h < 6; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += fsin(ph[h]) * amps[h]; }
    const br = noise.process(rng.next() * 2 - 1) * 0.05;
    out[i] = (s * 0.5 + br) * env;
  }
  return fadeEdges(normalize(out), 4, 55);
}

// 巴乌：比葫芦丝更暗，气声更重
function bawu(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.45) * SR);
  const out = new Float32Array(n);
  const ph = [0, 0, 0, 0, 0];
  const amps = [1, 0.28, 0.12, 0.05, 0.02];
  const noise = new Biquad().bandpass(1200, 0.7);
  const vibRate = 4.6 + rng.next() * 0.4;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.075);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.45) : 1;
    const env = atk * rel * (0.88 + 0.12 * Math.exp(-t / 0.4));
    const vib = 1 + 0.005 * clamp((t - 0.2) / 0.5, 0, 1) * fsin(TAU * vibRate * t);
    let s = 0;
    for (let h = 0; h < 5; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += fsin(ph[h]) * amps[h]; }
    const br = noise.process(rng.next() * 2 - 1) * 0.075;
    out[i] = (s * 0.45 + br) * env;
  }
  return fadeEdges(normalize(out), 6, 60);
}

// 京胡：高亢尖锐，强共鸣峰，窄音域感
function jinghu(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.4) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(16);
  const noise = new Biquad().bandpass(3000, 1.0);
  const f1 = new Biquad().bandpass(1100, 2.4);
  const f2 = new Biquad().bandpass(2600, 2.6);
  const vibRate = 6.4 + rng.next() * 0.6;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.03);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.32) : 1;
    const env = atk * rel;
    const vib = 1 + 0.011 * clamp((t - 0.1) / 0.3, 0, 1) * fsin(TAU * vibRate * t);
    let s = 0;
    for (let h = 1; h <= 15; h++) {
      ph[h - 1] += TAU * freq * h * vib / SR;
      s += fsin(ph[h - 1]) / (h * 0.75 + 0.5);
    }
    const bow = noise.process(rng.next() * 2 - 1) * 0.06;
    const x = s * 0.26 + bow;
    out[i] = (x + f1.process(x) * 0.55 + f2.process(x) * 0.4) * env * 0.62;
  }
  return fadeEdges(normalize(out), 3, 45);
}

// 板胡：比二胡亮、比京胡柔和，带板面共鸣
function banhu(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.45) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(14);
  const noise = new Biquad().bandpass(2400, 0.9);
  const body = new Biquad().bandpass(760, 1.8);
  const vibRate = 5.8 + rng.next() * 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.05);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.4) : 1;
    const env = atk * rel;
    const vib = 1 + 0.009 * clamp((t - 0.14) / 0.4, 0, 1) * fsin(TAU * vibRate * t);
    let s = 0;
    for (let h = 1; h <= 13; h++) {
      ph[h - 1] += TAU * freq * h * vib / SR;
      s += fsin(ph[h - 1]) / (h * 0.85 + 0.6);
    }
    const bow = noise.process(rng.next() * 2 - 1) * 0.045;
    const x = s * 0.3 + bow;
    out[i] = (x + body.process(x) * 0.45) * env * 0.62;
  }
  return fadeEdges(normalize(out), 3, 55);
}

// 柳琴：极明亮的弹拨，短促带金属感
function liuqin(freq, dur, vel, rng) {
  const t60 = clamp(1.1 * Math.pow(400 / freq, 0.3), 0.4, 1.6);
  const n = Math.floor((Math.min(dur, 1.5) + t60) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(12000, freq * 16), 0.5);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.08));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.92;
  const rho = Math.pow(0.002, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const hp = new Biquad().highpass(320, 0.7);
  const pick = Math.floor(0.006 * SR);
  const bp = new Biquad().bandpass(5200, 1.3);
  for (let i = 0; i < n; i++) out[i] = hp.process(out[i]);
  for (let i = 0; i < pick; i++) out[i] += bp.process(rng.next() * 2 - 1) * 0.6 * (1 - i / pick);
  return fadeEdges(normalize(out), 1, 30);
}

// 月琴：圆润的中高拨弦，比柳琴暖
function yueqin(freq, dur, vel, rng) {
  const t60 = clamp(1.8 * Math.pow(300 / freq, 0.35), 0.6, 2.4);
  const n = Math.floor((Math.min(dur, 2) + t60) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(6000, freq * 10), 0.6);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.14));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.86;
  const rho = Math.pow(0.002, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const body = new Biquad().bandpass(680, 1.5);
  const hp = new Biquad().highpass(180, 0.7);
  for (let i = 0; i < n; i++) { const x = hp.process(out[i]); out[i] = x + body.process(x) * 0.3; }
  return fadeEdges(normalize(out), 1, 40);
}

// 三弦：低频厚实的拨弦，共鸣箱大
function sanxian(freq, dur, vel, rng) {
  const t60 = clamp(2.1 * Math.pow(240 / freq, 0.4), 0.8, 3);
  const n = Math.floor((Math.min(dur, 2.5) + t60) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(4200, freq * 8), 0.6);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.18));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.8;
  const rho = Math.pow(0.002, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const body = new Biquad().bandpass(220, 1.3);
  const hp = new Biquad().highpass(80, 0.7);
  for (let i = 0; i < n; i++) { const x = hp.process(out[i]); out[i] = x + body.process(x) * 0.45; }
  return fadeEdges(normalize(out), 2, 60);
}

// 中阮：圆润饱满的中音拨弦
function ruan(freq, dur, vel, rng) {
  const t60 = clamp(2.4 * Math.pow(200 / freq, 0.4), 1, 3.4);
  const n = Math.floor((Math.min(dur, 3) + t60) * SR);
  const out = new Float32Array(n);
  const D = Math.max(2, SR / freq - 0.5);
  const M = Math.ceil(D) + 3;
  const line = new Float32Array(M);
  const lp = new Biquad().lowpass(Math.min(3600, freq * 7), 0.65);
  for (let i = 0; i < M; i++) line[i] = lp.process(rng.next() * 2 - 1);
  const off = Math.max(1, Math.round(M * 0.2));
  for (let i = M - 1; i >= off; i--) line[i] -= line[i - off] * 0.75;
  const rho = Math.pow(0.0015, 1 / (freq * t60));
  let w = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    let r = w - D; while (r < 0) r += M;
    const i0 = Math.floor(r) % M, frac = r - Math.floor(r);
    const y = line[i0] * (1 - frac) + line[(i0 + 1) % M] * frac;
    line[w] = (y + prev) * 0.5 * rho;
    prev = y;
    out[i] = y;
    w = (w + 1) % M;
  }
  const body = new Biquad().bandpass(320, 1.2);
  for (let i = 0; i < n; i++) { const x = out[i]; out[i] = x + body.process(x) * 0.4; }
  return fadeEdges(normalize(out), 2, 70);
}

// 箜篌：竖琴式拨弦，清亮带长泛音
function konghou(freq, dur, vel, rng) {
  const t60 = clamp(3.4 * Math.pow(260 / freq, 0.4), 1.4, 5);
  const n = Math.floor((dur + Math.min(t60 * 0.7, 3.5)) * SR);
  const out = new Float32Array(n);
  const partials = [[1, 1, t60 * 0.5], [2.01, 0.42, t60 * 0.32], [3.01, 0.22, t60 * 0.22],
    [4.02, 0.12, t60 * 0.15], [5.4, 0.06, t60 * 0.1], [7.1, 0.03, t60 * 0.07]];
  const ph = partials.map(() => rng.next() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.003);
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += TAU * freq * partials[k][0] / SR;
      s += fsin(ph[k]) * partials[k][1] * Math.exp(-t / partials[k][2]);
    }
    out[i] = s * atk;
  }
  return fadeEdges(normalize(out), 1, 80);
}

// 编磬：石制，比编钟更脆更短，高频突出
function bianqing(freq, dur, vel, rng) {
  const n = Math.floor((Math.min(dur, 1) + 2.2) * SR);
  const out = new Float32Array(n);
  const partials = [[1, 0.9, 1.6], [2.76, 0.55, 1.0], [5.4, 0.3, 0.55], [8.9, 0.14, 0.3], [13.2, 0.06, 0.18]];
  const ph = partials.map(() => rng.next() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.002);
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += TAU * freq * partials[k][0] / SR;
      s += fsin(ph[k]) * partials[k][1] * Math.exp(-t / partials[k][2]);
    }
    out[i] = s * atk;
  }
  const hit = Math.floor(0.005 * SR);
  const hp = new Biquad().highpass(2000, 0.8);
  for (let i = 0; i < hit; i++) out[i] += hp.process(rng.next() * 2 - 1) * 0.5 * (1 - i / hit);
  return fadeEdges(normalize(out), 1, 90);
}

// 管子：双簧，比唢呐暗而苍，带鼻音
function guanzi(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.4) * SR);
  const out = new Float32Array(n);
  const ph = new Float32Array(14);
  const form = new Biquad().bandpass(1250, 1.6);
  const noise = new Biquad().bandpass(2600, 1.0);
  const vibRate = 5.6 + rng.next() * 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.045);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.35) : 1;
    const env = atk * rel * (0.88 + 0.12 * Math.exp(-t / 0.25));
    const vib = 1 + 0.008 * clamp((t - 0.15) / 0.4, 0, 1) * fsin(TAU * vibRate * t);
    let s = 0;
    for (let h = 1; h <= 13; h++) {
      ph[h - 1] += TAU * freq * h * vib / SR;
      s += fsin(ph[h - 1]) / (h * 0.95 + 0.5);
    }
    const br = noise.process(rng.next() * 2 - 1) * 0.03;
    const x = s * 0.24 + br;
    out[i] = (x + form.process(x) * 0.7) * env * 0.7;
  }
  return fadeEdges(normalize(out), 3, 50);
}

// 陶笛：圆润空灵，几乎纯正弦加少量二次谐波
function ocarina(freq, dur, vel, rng) {
  const n = Math.floor((dur + 0.4) * SR);
  const out = new Float32Array(n);
  const ph = [0, 0, 0, 0];
  const amps = [1, 0.18, 0.07, 0.03];
  const noise = new Biquad().lowpass(2400, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.05);
    const rel = t > dur ? Math.max(0, 1 - (t - dur) / 0.4) : 1;
    const env = atk * rel * (0.92 + 0.08 * Math.exp(-t / 0.3));
    const vib = 1 + 0.003 * clamp((t - 0.25) / 0.5, 0, 1) * fsin(TAU * 5.0 * t);
    let s = 0;
    for (let h = 0; h < 4; h++) { ph[h] += TAU * freq * (h + 1) * vib / SR; s += fsin(ph[h]) * amps[h]; }
    const br = noise.process(rng.next() * 2 - 1) * 0.028;
    out[i] = (s * 0.6 + br) * env;
  }
  return fadeEdges(normalize(out), 5, 60);
}

// 排鼓：一排不同音高的鼓，敲击清脆
function paigu(freq, dur, vel, rng) {
  const n = Math.floor(0.7 * SR);
  const out = new Float32Array(n);
  const base = 110 + (freq % 220);
  let phase = 0;
  const bp = new Biquad().bandpass(base * 6, 1.1);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = base * (1 + 0.55 * Math.exp(-t / 0.03));
    phase += TAU * f / SR;
    const body = fsin(phase) * Math.exp(-t / 0.14);
    const skin = bp.process(rng.next() * 2 - 1) * Math.exp(-t / 0.05) * 0.55;
    out[i] = (body * 0.8 + skin) * (0.6 + 0.4 * vel);
  }
  return fadeEdges(normalize(out), 1, 35);
}

// 梆子：硬木敲击，极短极亮
function bangzi(freq, dur, vel, rng) {
  const n = Math.floor(0.16 * SR);
  const out = new Float32Array(n);
  const bp = new Biquad().bandpass(2400, 6);
  const hp = new Biquad().highpass(1200, 0.8);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p += TAU * 1250 / SR;
    const click = bp.process(rng.next() * 2 - 1) * Math.exp(-t / 0.012);
    const tone = hp.process(fsin(p)) * Math.exp(-t / 0.03) * 0.7;
    out[i] = (click * 1.1 + tone) * (0.6 + 0.4 * vel);
  }
  return fadeEdges(normalize(out), 0.5, 12);
}

// 碰铃：小铜铃，清亮长鸣
function pengling(freq, dur, vel, rng) {
  const n = Math.floor(2.4 * SR);
  const out = new Float32Array(n);
  const base = Math.max(1200, freq * 4);
  const partials = [[1, 1, 1.5], [2.4, 0.5, 0.9], [3.9, 0.25, 0.5], [5.7, 0.1, 0.3]];
  const ph = partials.map(() => rng.next() * TAU);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < partials.length; k++) {
      ph[k] += TAU * base * partials[k][0] / SR;
      s += fsin(ph[k]) * partials[k][1] * Math.exp(-t / partials[k][2]);
    }
    out[i] = s * Math.min(1, t / 0.002);
  }
  return fadeEdges(normalize(out), 0.5, 120);
}

export const INSTRUMENTS = {
  // ── 拨弦（丝）──
  guzheng: { name: '古筝', en: 'Guzheng', fn: guzheng, color: '#e7b45c', desc: '拨弦 · 弦模型 + 琴体共振', gain: 0.92, gm: 107, family: 'pluck' },
  guqin: { name: '古琴', en: 'Guqin', fn: guqin, color: '#b08a63', desc: '拨弦 · 暗色长余音', gain: 0.8, gm: 108, family: 'pluck' },
  pipa: { name: '琵琶', en: 'Pipa', fn: pipa, color: '#f0a35e', desc: '弹拨 · 明亮短促 + 轮指', gain: 0.78, gm: 105, family: 'pluck' },
  liuqin: { name: '柳琴', en: 'Liuqin', fn: liuqin, color: '#ffc857', desc: '弹拨 · 极明亮带金属感', gain: 0.62, gm: 106, family: 'pluck' },
  yueqin: { name: '月琴', en: 'Yueqin', fn: yueqin, color: '#e6c178', desc: '弹拨 · 圆润中高音', gain: 0.7, gm: 107, family: 'pluck' },
  sanxian: { name: '三弦', en: 'Sanxian', fn: sanxian, color: '#c49a5c', desc: '弹拨 · 低频厚实共鸣', gain: 0.72, gm: 106, family: 'pluck' },
  ruan: { name: '中阮', en: 'Ruan', fn: ruan, color: '#bfa06a', desc: '弹拨 · 圆润饱满中音', gain: 0.72, gm: 107, family: 'pluck' },
  konghou: { name: '箜篌', en: 'Konghou', fn: konghou, color: '#f2d79f', desc: '拨弦 · 清亮长泛音', gain: 0.66, gm: 46, family: 'pluck' },
  yangqin: { name: '扬琴', en: 'Yangqin', fn: yangqin, color: '#d9c07a', desc: '击弦 · 金属泛音快衰减', gain: 0.6, gm: 15, family: 'metal' },

  // ── 拉弦（丝）──
  erhu: { name: '二胡', en: 'Erhu', fn: erhu, color: '#e0876a', desc: '拉弦 · 锯齿波族 + 鼻音共鸣', gain: 0.62, gm: 110, family: 'bow' },
  jinghu: { name: '京胡', en: 'Jinghu', fn: jinghu, color: '#ff8a6b', desc: '拉弦 · 高亢尖锐', gain: 0.5, gm: 110, family: 'bow' },
  banhu: { name: '板胡', en: 'Banhu', fn: banhu, color: '#e09a6a', desc: '拉弦 · 明亮带板面共鸣', gain: 0.56, gm: 110, family: 'bow' },

  // ── 吹管（竹/匏）──
  dizi: { name: '笛', en: 'Dizi', fn: dizi, color: '#7fc8b0', desc: '吹管 · 加法合成 + 气声颤音', gain: 0.5, gm: 73, family: 'wind' },
  xiao: { name: '箫', en: 'Xiao', fn: xiao, color: '#6aa9a0', desc: '吹管 · 低谐波 + 重气声', gain: 0.55, gm: 75, family: 'wind' },
  xun: { name: '埙', en: 'Xun', fn: xun, color: '#c98f6d', desc: '陶埙 · 近正弦 + 慢起音', gain: 0.62, gm: 75, family: 'wind' },
  sheng: { name: '笙', en: 'Sheng', fn: sheng, color: '#9fd6a8', desc: '簧片 · 奇偶谐波 + 拍频', gain: 0.5, gm: 72, family: 'wind' },
  suona: { name: '唢呐', en: 'Suona', fn: suona, color: '#e06b5e', desc: '吹管 · 簧片方波 + 强颤音', gain: 0.42, gm: 111, family: 'wind' },
  guanzi: { name: '管子', en: 'Guanzi', fn: guanzi, color: '#c9836b', desc: '双簧 · 苍劲带鼻音', gain: 0.48, gm: 111, family: 'wind' },
  hulusi: { name: '葫芦丝', en: 'Hulusi', fn: hulusi, color: '#8fc9a0', desc: '吹管 · 温暖圆润', gain: 0.55, gm: 72, family: 'wind' },
  bawu: { name: '巴乌', en: 'Bawu', fn: bawu, color: '#7bb59a', desc: '吹管 · 幽暗气声重', gain: 0.55, gm: 72, family: 'wind' },
  ocarina: { name: '陶笛', en: 'Ocarina', fn: ocarina, color: '#c8b98a', desc: '吹管 · 圆润空灵', gain: 0.55, gm: 79, family: 'wind' },

  // ── 打击（革/金/石/木）──
  bianzhong: { name: '编钟', en: 'Bianzhong', fn: bianzhong, color: '#9fb6d9', desc: '钟磬 · 非谐分音 + 拍频', gain: 0.55, gm: 14, family: 'metal' },
  bianqing: { name: '编磬', en: 'Bianqing', fn: bianqing, color: '#a8c4e0', desc: '石磬 · 清脆高频', gain: 0.42, gm: 14, family: 'metal' },
  gong: { name: '锣', en: 'Gong', fn: gong, color: '#c9a35e', desc: '打击 · 低频非谐长衰减', gain: 0.45, gm: 14, family: 'metal' },
  pengling: { name: '碰铃', en: 'Pengling', fn: pengling, color: '#e8d9a8', desc: '小铜铃 · 清亮长鸣', gain: 0.34, gm: 112, family: 'metal' },
  drum: { name: '鼓', en: 'Drum', fn: drum, color: '#d98c8c', desc: '打击 · 下滑正弦 + 噪声', gain: 0.62, gm: 0, family: 'perc' },
  paigu: { name: '排鼓', en: 'Paigu', fn: paigu, color: '#cf8f8f', desc: '打击 · 有音高鼓点', gain: 0.58, gm: 116, family: 'perc' },
  muyu: { name: '木鱼', en: 'Muyu', fn: muyu, color: '#b9a27e', desc: '打击 · 窄带噪声', gain: 0.42, gm: 115, family: 'perc' },
  bangzi: { name: '梆子', en: 'Bangzi', fn: bangzi, color: '#c9a888', desc: '硬木 · 极短极亮', gain: 0.38, gm: 115, family: 'perc' },

  // ── 电子 / 铺底 ──
  pad: { name: '弦垫', en: 'Pad', fn: pad, color: '#a99bf0', desc: '铺底 · 三路微失谐', gain: 0.42, gm: 48, family: 'pad' },
  bass: { name: '低音', en: 'Bass', fn: bass, color: '#9dabbb', desc: '低频 · 三角波加法', gain: 0.8, gm: 32, family: 'bass' },

  // ── 氛围 ──
  rain: { name: '雨声', en: 'Rain', fn: null, color: '#6fb7c8', desc: '氛围 · 噪声床 + 随机雨滴', gain: 0.5, gm: 122, family: 'amb' },
  wind: { name: '风声', en: 'Wind', fn: null, color: '#7d9bc4', desc: '氛围 · 带通噪声 + 阵风', gain: 0.45, gm: 121, family: 'amb' },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

// 渲染单个音符（含释放尾巴），返回归一化单声道缓冲
export function renderNote(id, freq, dur, vel = 0.8, rng) {
  const inst = INSTRUMENTS[id] || INSTRUMENTS.guzheng;
  if (typeof inst.fn !== 'function') return new Float32Array(0); // 氛围层不是「音符」
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
