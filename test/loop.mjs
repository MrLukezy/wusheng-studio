// 循环曲式校验：导出 WAV 的长度必须精确等于循环长度，接缝处不能有跳变
// 用法：BASE=https://www.lukezystudio.cn/music/ node test/loop.mjs
import fs from 'node:fs';
import { launch, OUT_DIR, BASE } from './_browser.mjs';

const BARS = 16, BPM = 96;
const SR = 44100;
const expectFrames = Math.round(BARS * 4 * 60 / BPM * SR);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const hash = `#seed=11&mood=xiandai&mode=4&key=A&bpm=${BPM}&density=60&bars=${BARS}&loop=1`
  + '&tracks=lead%3Aguzheng%2Charm%3Apipa%2Cbass%3Abass%2Cperc%3Adrum';
await page.goto(BASE + hash, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#title').textContent !== '还没有曲子', { timeout: 30000 });
await page.waitForTimeout(1500);

const ui = await page.evaluate(() => ({
  tag: document.querySelector('#loopTag').hidden ? null : document.querySelector('#loopTag').textContent,
  dur: document.querySelector('#mDur').textContent,
  loopOn: window.__ws.player.loop,
  playerDur: +window.__ws.player.duration.toFixed(3),
  sections: [...document.querySelectorAll('.mix-row')].length,
}));
console.log('UI:', JSON.stringify(ui));

await page.click('#btnPlay');
await page.waitForTimeout(1200);
const playing = await page.evaluate(() => ({
  pos: +window.__ws.player.position.toFixed(2),
  srcLoop: window.__ws.player.sources[0]?.loop ?? null,
}));
console.log('播放:', JSON.stringify(playing));

const dlP = page.waitForEvent('download', { timeout: 90000 });
await page.click('#btnWav');
const dl = await dlP;
const wavPath = `${OUT_DIR}loop.wav`;
await dl.saveAs(wavPath);
await browser.close();

const buf = fs.readFileSync(wavPath);
const ch = buf.readUInt16LE(22), rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
const frames = buf.readUInt32LE(40) / (ch * bits / 8);
const L = new Float32Array(frames);
for (let i = 0; i < frames; i++) L[i] = buf.readInt16LE(44 + i * ch * 2) / 32768;

const seam = Math.abs(L[0] - L[frames - 1]);
let diffs = 0, n = 0;
for (let i = 0; i < Math.min(frames - 1, rate); i += 7) { diffs += Math.abs(L[i + 1] - L[i]); n++; }
const avgDiff = diffs / n;
let rms = 0;
for (let i = 0; i < frames; i++) rms += L[i] * L[i];
rms = Math.sqrt(rms / frames);

console.log(`WAV: ch=${ch} ${rate}Hz ${bits}bit frames=${frames} 时长=${(frames / rate).toFixed(3)}s`);
console.log(`接缝跳变=${seam.toFixed(4)} 相邻样本平均差=${avgDiff.toFixed(4)} 整体RMS=${rms.toFixed(3)}`);

const checks = [
  [frames === expectFrames, `帧数与循环长度一致（${expectFrames}）`],
  [ui.tag === 'LOOP' && ui.loopOn === true, '界面进入循环模式'],
  [playing.srcLoop === true, '播放源开启 sample 级循环'],
  [seam < avgDiff * 3 && seam < 0.05, '接缝无跳变（小于正常样本差 3 倍）'],
  [rms > 0.05, '整体有内容'],
  [errors.length === 0, '无控制台错误'],
];
let fail = 0;
for (const [ok, msg] of checks) { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) fail++; }
console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 循环曲式通过');
process.exit(fail ? 1 : 0);
