// 渲染 Worker：把「合成 → 混音 → 折返」全部搬离主线程
// 主线程只负责发指令和接收进度，UI 全程不卡
import { SR } from './theory.js';
import { renderNote, renderAmbience, INSTRUMENTS } from './synth.js';
import { Rng } from './rng.js';

const TAIL_BEATS = 2.5;

function plan(piece) {
  const secPerBeat = 60 / piece.meta.bpm;
  let endBeat = 0;
  for (const n of piece.notes) endBeat = Math.max(endBeat, n.t + n.dur);
  const loop = !!piece.meta.loop;
  const loopLen = loop ? Math.round(piece.meta.beats * secPerBeat * SR) : 0;
  const musicalLen = loop ? loopLen / SR : endBeat * secPerBeat;
  const duration = loop ? loopLen / SR : endBeat * secPerBeat + TAIL_BEATS * secPerBeat + 1.6;
  const total = loop ? loopLen + 4 * SR : Math.ceil(duration * SR);
  return { secPerBeat, loop, loopLen, musicalLen, duration, total };
}

self.onmessage = async (e) => {
  const { id, piece } = e.data || {};
  if (!piece) return;

  try {
    const { secPerBeat, loop, loopLen, duration, total } = plan(piece);
    const trackIds = piece.tracks.map(t => t.id);
    const arrays = new Map();
    for (const tid of trackIds) arrays.set(tid, new Float32Array(total));

    // 氛围层：连续纹理
    for (const a of (piece.ambience || [])) {
      const arr = arrays.get(a.track);
      if (!arr) continue;
      const tex = renderAmbience(a.inst, total / SR, new Rng(`${piece.meta.seed}|amb|${a.inst}`));
      const lim = Math.min(tex.length, total);
      for (let i = 0; i < lim; i++) arr[i] += tex[i];
    }
    self.postMessage({ id, type: 'progress', phase: '纹理', value: 0.04 });

    // 音符：分块渲染，每块结束汇报进度并让出
    const rng = new Rng(`${piece.meta.seed}|render`);
    const notes = piece.notes;
    let lastReport = 0;
    const REPORT_MS = 80;
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k];
      const arr = arrays.get(n.track);
      if (arr) {
        const freq = n.midi > 0 ? 440 * Math.pow(2, (n.midi - 69) / 12) : 110;
        const buf = renderNote(n.inst, freq, n.dur * secPerBeat, n.vel, rng);
        const start = Math.max(0, Math.round(n.t * secPerBeat * SR));
        const g = n.vel * (INSTRUMENTS[n.inst]?.gain ?? 0.7) * 0.62;
        const lim = Math.min(buf.length, total - start);
        for (let i = 0; i < lim; i++) arr[start + i] += buf[i] * g;
      }
      const now = Date.now();
      if (now - lastReport >= REPORT_MS || k === notes.length - 1) {
        lastReport = now;
        self.postMessage({
          id, type: 'progress', phase: '合成',
          value: 0.05 + 0.85 * ((k + 1) / notes.length),
          done: k + 1, total: notes.length,
        });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 循环曲式：尾巴折回开头
    if (loop) {
      for (const a of arrays.values()) {
        for (let i = loopLen; i < a.length; i++) a[i - loopLen] += a[i];
      }
    }
    const outLen = loop ? loopLen : total;

    // 逐轨归一化到共同的峰值，再打包
    let peak = 0;
    for (const a of arrays.values()) {
      for (let i = 0; i < outLen; i++) { const v = Math.abs(a[i]); if (v > peak) peak = v; }
    }
    const g = peak > 1e-6 ? Math.min(1, 0.95 / peak) : 1;

    self.postMessage({ id, type: 'progress', phase: '混音', value: 0.94 });
    const buffers = [];
    for (const tid of trackIds) {
      const a = arrays.get(tid);
      const ab = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) ab[i] = a[i] * g;
      buffers.push({ id: tid, data: ab.buffer });
    }
    self.postMessage(
      { id, type: 'done', sampleRate: SR, length: outLen, duration, loop, loopLen, buffers },
      buffers.map(b => b.data),
    );
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
