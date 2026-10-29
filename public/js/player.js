// Web Audio 播放器 + 离线渲染（导出与试听共用同一套合成）
import { SR } from './theory.js';
import { renderNote, renderAmbience, INSTRUMENTS } from './synth.js';
import { Rng } from './rng.js';

const TAIL_BEATS = 2.5;

function makeIR(ctx, seconds = 2.6, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.pow(1 - i / len, decay);
      // 早期反射 + 扩散噪声，简单滤波让高频衰减更快
      const nz = Math.random() * 2 - 1;
      lp = lp * 0.72 + nz * 0.28;
      d[i] = lp * env * (c ? 0.92 : 1);
    }
    // 几个明显早期反射，增加空间感
    for (const [ms, g] of [[11, 0.5], [23, 0.34], [37, 0.24], [53, 0.16]]) {
      const idx = Math.floor(ms / 1000 * rate);
      if (idx < len) d[idx] += g * (c ? -1 : 1);
    }
  }
  return buf;
}

export class Player {
  constructor() {
    this.ctx = null;
    this.piece = null;
    this.trackBuffers = new Map();
    this.duration = 0;
    this.playing = false;
    this.startCtxTime = 0;
    this.startOffset = 0;
    this.sources = [];
    this.nodes = new Map();
    this.mute = new Set();
    this.solo = null;
    this.gains = {};
    this.loop = false;
    this.onended = null;
    this._raf = null;
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ sampleRate: 44100 });
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.82;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 24;
      this.comp.ratio.value = 3.2; this.comp.attack.value = 0.006; this.comp.release.value = 0.25;
      this.wet = ctx.createGain(); this.wet.gain.value = 0.24;
      this.conv = ctx.createConvolver(); this.conv.buffer = makeIR(ctx);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.comp);
      this.comp.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.conv.connect(this.wet); this.wet.connect(this.master);
    }
    if (this.ctx.state === 'suspended') { this.ctx.resume().catch(() => {}); }
    return this.ctx;
  }

  // 渲染整首曲子：每个音轨一条 AudioBuffer
  async build(piece, onProgress) {
    await this.ensure();
    const secPerBeat = 60 / piece.meta.bpm;
    let endBeat = 0;
    for (const n of piece.notes) endBeat = Math.max(endBeat, n.t + n.dur);
    this.duration = endBeat * secPerBeat + TAIL_BEATS * secPerBeat + 1.6;
    const total = Math.ceil(this.duration * SR);
    const ctx = this.ctx;

    this.trackBuffers.clear();
    const trackIds = piece.tracks.map(t => t.id);
    const arrays = new Map();
    for (const id of trackIds) arrays.set(id, new Float32Array(total));

    // 氛围轨：整段纹理，一次渲染
    const amb = piece.ambience || [];
    for (const a of amb) {
      const arr = arrays.get(a.track);
      if (!arr) continue;
      const tex = renderAmbience(a.inst, total / SR, new Rng(`${piece.meta.seed}|amb|${a.inst}`));
      const lim = Math.min(tex.length, total);
      for (let i = 0; i < lim; i++) arr[i] += tex[i];
    }

    let done = 0;
    const rng = new Rng(`${piece.meta.seed}|render`);
    for (const n of piece.notes) {
      const arr = arrays.get(n.track);
      if (!arr) continue;
      const freq = n.midi > 0 ? 440 * Math.pow(2, (n.midi - 69) / 12) : 110;
      const buf = renderNote(n.inst, freq, n.dur * secPerBeat, n.vel, rng);
      const start = Math.max(0, Math.round(n.t * secPerBeat * SR));
      const g = n.vel * (INSTRUMENTS[n.inst]?.gain ?? 0.7) * 0.62;
      const lim = Math.min(buf.length, total - start);
      for (let i = 0; i < lim; i++) arr[start + i] += buf[i] * g;
      done++;
      if (onProgress && done % 24 === 0) { onProgress(done / piece.notes.length); await new Promise(r => setTimeout(r, 0)); }
    }

    for (const id of trackIds) {
      const a = arrays.get(id);
      const ab = ctx.createBuffer(1, total, SR);
      ab.copyToChannel(a, 0);
      this.trackBuffers.set(id, ab);
    }
    this.piece = piece;
    this.gains = {};
    for (const t of piece.tracks) this.gains[t.id] = t.gain ?? 0.7;
    if (onProgress) onProgress(1);
    return this.duration;
  }

  _effectiveGain(id) {
    if (this.solo) return this.solo === id ? this.gains[id] : 0;
    if (this.mute.has(id)) return 0;
    return this.gains[id];
  }

  _teardown() {
    for (const s of this.sources) { try { s.stop(); } catch (e) { } s.disconnect(); }
    this.sources = [];
    for (const n of this.nodes.values()) { try { n.gain.disconnect(); n.pan.disconnect(); } catch (e) { } }
    this.nodes.clear();
  }

  async play(offset = null) {
    await this.ensure();
    if (!this.piece) return;
    this._teardown();
    const ctx = this.ctx;
    const off = offset != null ? offset : this.startOffset;
    this.startOffset = off < this.duration - 0.05 ? off : 0;
    const when = ctx.currentTime + 0.06;
    this.startCtxTime = when;
    for (const [id, buf] of this.trackBuffers) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = this._effectiveGain(id);
      const pan = ctx.createStereoPanner();
      pan.pan.value = this.piece.trackDefs?.[id]?.pan ?? 0;
      const send = ctx.createGain(); send.gain.value = 0.5;
      src.connect(gain); gain.connect(pan); pan.connect(this.master); pan.connect(send); send.connect(this.conv);
      src.start(when, Math.min(this.startOffset, buf.duration - 0.01));
      this.sources.push(src);
      this.nodes.set(id, { gain, pan, send });
    }
    this.playing = true;
    const remaining = (this.duration - this.startOffset) * 1000;
    clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => this._handleEnd(), Math.max(50, remaining + 120));
  }

  _handleEnd() {
    if (!this.playing) return;
    if (this.loop) { this.startOffset = 0; this.play(0); return; }
    this.stop();
    if (this.onended) this.onended();
  }

  pause() {
    if (!this.playing) return;
    this.startOffset = this.position;
    this.playing = false;
    clearTimeout(this._endTimer);
    this._teardown();
  }

  stop() {
    this.playing = false;
    this.startOffset = 0;
    clearTimeout(this._endTimer);
    this._teardown();
  }

  seek(t) {
    this.startOffset = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(this.startOffset);
  }

  get position() {
    if (!this.ctx) return this.startOffset;
    if (!this.playing) return this.startOffset;
    return Math.min(this.duration, this.startOffset + (this.ctx.currentTime - this.startCtxTime));
  }

  setTrackGain(id, v) {
    this.gains[id] = v;
    const n = this.nodes.get(id);
    if (n) n.gain.gain.setTargetAtTime(this._effectiveGain(id), this.ctx.currentTime, 0.03);
  }
  setMute(id, on) {
    on ? this.mute.add(id) : this.mute.delete(id);
    const n = this.nodes.get(id);
    if (n) n.gain.gain.setTargetAtTime(this._effectiveGain(id), this.ctx.currentTime, 0.02);
  }
  setSolo(id) {
    this.solo = id;
    for (const [tid, n] of this.nodes) n.gain.gain.setTargetAtTime(this._effectiveGain(tid), this.ctx.currentTime, 0.02);
  }

  // 单音试听（五声键盘 / 音色试听）
  async trigger(inst, freq, dur = 0.9, vel = 0.9) {
    await this.ensure();
    const buf = renderNote(inst, freq, dur, vel, new Rng(Math.random() * 1e9));
    const ab = this.ctx.createBuffer(1, buf.length, SR);
    ab.copyToChannel(buf, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = ab;
    const g = this.ctx.createGain();
    g.gain.value = 0.85;
    const pan = this.ctx.createStereoPanner();
    src.connect(g); g.connect(pan); pan.connect(this.master); pan.connect(this.conv);
    src.start();
    return ab.duration;
  }

  // 离线渲染（导出 WAV 用），与播放同样的图
  async renderOffline(piece, opts = {}) {
    const secPerBeat = 60 / piece.meta.bpm;
    let endBeat = 0;
    for (const n of piece.notes) endBeat = Math.max(endBeat, n.t + n.dur);
    const duration = endBeat * secPerBeat + TAIL_BEATS * secPerBeat + 2.2;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(duration * SR), SR);

    const master = ctx.createGain(); master.gain.value = 0.82;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 3.2;
    comp.attack.value = 0.006; comp.release.value = 0.25;
    const wet = ctx.createGain(); wet.gain.value = 0.24;
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx);
    master.connect(comp); comp.connect(ctx.destination);
    conv.connect(wet); wet.connect(master);

    const arrays = new Map();
    for (const t of piece.tracks) arrays.set(t.id, new Float32Array(ctx.length));
    for (const a of (piece.ambience || [])) {
      const arr = arrays.get(a.track);
      if (!arr) continue;
      const tex = renderAmbience(a.inst, ctx.length / SR, new Rng(`${piece.meta.seed}|amb|${a.inst}`));
      const lim = Math.min(tex.length, arr.length);
      for (let i = 0; i < lim; i++) arr[i] += tex[i];
    }
    const rng = new Rng(`${piece.meta.seed}|render`);
    for (const n of piece.notes) {
      const arr = arrays.get(n.track);
      if (!arr) continue;
      const freq = n.midi > 0 ? 440 * Math.pow(2, (n.midi - 69) / 12) : 110;
      const buf = renderNote(n.inst, freq, n.dur * secPerBeat, n.vel, rng);
      const start = Math.max(0, Math.round(n.t * secPerBeat * SR));
      const g = n.vel * (INSTRUMENTS[n.inst]?.gain ?? 0.7) * 0.62;
      const lim = Math.min(buf.length, arr.length - start);
      for (let i = 0; i < lim; i++) arr[start + i] += buf[i] * g;
    }
    for (const t of piece.tracks) {
      const ab = ctx.createBuffer(1, ctx.length, SR);
      ab.copyToChannel(arrays.get(t.id), 0);
      const src = ctx.createBufferSource(); src.buffer = ab;
      const gain = ctx.createGain();
      const muted = (opts.mute && opts.mute.has(t.id)) || (opts.solo && opts.solo !== t.id);
      gain.gain.value = muted ? 0 : (opts.gains?.[t.id] ?? t.gain ?? 0.7);
      const pan = ctx.createStereoPanner();
      pan.pan.value = piece.trackDefs?.[t.id]?.pan ?? 0;
      const send = ctx.createGain(); send.gain.value = 0.5;
      src.connect(gain); gain.connect(pan); pan.connect(master); pan.connect(send); send.connect(conv);
      src.start(0);
    }
    const rendered = await ctx.startRendering();
    // 归一化到 -1 dBFS 附近
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const d = rendered.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    if (peak > 1e-6) {
      const g = Math.min(2.2, Math.max(0.6, 0.89 / peak));
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const d = rendered.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= g;
      }
    }
    return rendered;
  }
}
