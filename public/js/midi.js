// 标准 MIDI 文件（SMF format 1）写入器，无第三方依赖
import { INSTRUMENTS } from './synth.js';

const PPQ = 480;

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}
function str(s) { return Array.from(s, c => c.charCodeAt(0) & 0x7f); }
function u32(n) { return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function u16(n) { return [(n >> 8) & 255, n & 255]; }

const CHANNEL = { lead: 0, harm: 1, pad: 2, bass: 3, perc: 9 };
const TRACK_EN = { lead: 'Lead', harm: 'Harmony', pad: 'Pad', bass: 'Bass', perc: 'Perc' };
const PERC_NOTE = { drum: 36, muyu: 76 };

export function encodeMidi(piece) {
  const { meta, notes } = piece;
  const tracks = [];

  // 0) 速度轨
  const tempo = [];
  const usPerBeat = Math.round(60000000 / meta.bpm);
  const tname = 'Wusheng Music';
  tempo.push(0x00, 0xff, 0x03, ...vlq(tname.length), ...str(tname));
  tempo.push(...[0x00, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255]);
  tempo.push(...[0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]);
  tempo.push(0x00, 0xff, 0x2f, 0x00);
  tracks.push(tempo);

  // 1) 每个音轨一条
  for (const t of piece.tracks) {
    const ch = CHANNEL[t.id] ?? 0;
    const evs = [];
    const first = notes.find(n => n.track === t.id);
    const gm = first ? (INSTRUMENTS[first.inst]?.gm ?? 0) : 0;
    const nameAscii = TRACK_EN[t.id] || 'Track';
    evs.push({ tick: 0, data: [0xff, 0x03, ...vlq(nameAscii.length), ...str(nameAscii)] });
    if (ch !== 9) evs.push({ tick: 0, data: [0xc0 | ch, gm & 0x7f] });
    evs.push({ tick: 0, data: [0xb0 | ch, 7, Math.round(100 * (t.gain || 0.7))] });
    for (const n of notes) {
      if (n.track !== t.id) continue;
      const start = Math.max(0, Math.round(n.t * PPQ));
      const dur = Math.max(1, Math.round(n.dur * PPQ * 0.98));
      const vel = Math.round(Math.min(1, Math.max(0.05, n.vel)) * 127);
      const noteNum = ch === 9 ? (PERC_NOTE[n.inst] || 36) : Math.max(0, Math.min(127, n.midi));
      evs.push({ tick: start, data: [0x90 | ch, noteNum, vel], order: 1 });
      evs.push({ tick: start + dur, data: [0x80 | ch, noteNum, 0], order: 0 });
    }
    evs.sort((a, b) => a.tick - b.tick || (a.order ?? 0) - (b.order ?? 0));
    const bytes = [];
    let last = 0;
    for (const e of evs) {
      bytes.push(...vlq(e.tick - last), ...e.data);
      last = e.tick;
    }
    bytes.push(0x00, 0xff, 0x2f, 0x00);
    tracks.push(bytes);
  }

  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  const chunks = [];
  for (const t of tracks) chunks.push(...str('MTrk'), ...u32(t.length), ...t);
  return new Uint8Array([...header, ...chunks]);
}

export function downloadMidi(piece, filename) {
  const bytes = encodeMidi(piece);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
