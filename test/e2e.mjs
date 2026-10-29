// Playwright 端到端：AI 生成 / 参数重排 / 音轨增删 / 导出 / 截图
// 用法：BASE=https://www.lukezystudio.cn/music/ node test/e2e.mjs
import fs from 'node:fs';
import { launch, OUT_DIR, BASE } from './_browser.mjs';

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const text = sel => page.textContent(sel);
const wait = ms => page.waitForTimeout(ms);

console.log('→ 打开', BASE);
await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(500);

// 1) AI 生成
console.log('→ 输入灵感并生成');
await page.fill('#inspire', '雨夜独处，二胡为主，加点雨声，别太吵');
await page.click('#btnGenerate');
await page.waitForFunction(() => document.querySelector('#title').textContent !== '还没有曲子', { timeout: 60000 });
await wait(1200);

const info = await page.evaluate(() => ({
  title: document.querySelector('#title').textContent,
  desc: document.querySelector('#desc').textContent,
  reason: document.querySelector('#reason').hidden ? '' : document.querySelector('#reason').textContent,
  badge: document.querySelector('#engineBadge').textContent,
  tempo: document.querySelector('#mTempo').textContent,
  dur: document.querySelector('#mDur').textContent,
  bars: document.querySelector('#mBars').textContent,
  notes: document.querySelector('#mNotes').textContent,
  status: document.querySelector('#genStatus').textContent,
  tracks: [...document.querySelectorAll('.mix-row')].map(r => ({
    role: r.querySelector('.rname').textContent,
    inst: r.querySelector('.inst').selectedOptions[0]?.textContent,
  })),
  hash: location.hash,
}));
console.log('  曲目:', JSON.stringify(info, null, 1));

// 2) 参数重排：改速度 / 改长度
console.log('→ 调速度到 96，长度到 28 小节');
await page.evaluate(() => {
  const b = document.querySelector('#bpm'); b.value = 96; b.dispatchEvent(new Event('input', { bubbles: true }));
  const s = document.querySelector('#bars'); s.value = 28; s.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(2600);
const afterParam = await page.evaluate(() => ({
  tempo: document.querySelector('#mTempo').textContent,
  bars: document.querySelector('#mBars').textContent,
  title: document.querySelector('#title').textContent,
  status: document.querySelector('#genStatus').textContent,
}));
console.log('  重排后:', JSON.stringify(afterParam));

// 3) 添加音轨（氛围）
console.log('→ 添加氛围轨');
await page.click('#btnAddTrack');
await page.click('#addMenu button:not([disabled])');
await wait(2600);
const afterAdd = await page.evaluate(() => ({
  rows: document.querySelectorAll('.mix-row').length,
  tracks: [...document.querySelectorAll('.mix-row .inst')].map(s => s.selectedOptions[0]?.textContent),
}));
console.log('  音轨:', JSON.stringify(afterAdd));

// 4) 换音色：把副旋律换成琵琶
console.log('→ 换音色');
const changed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.mix-row')];
  const row = rows.find(r => r.querySelector('.rname').textContent !== '主旋律' && r.querySelector('.inst').options.length > 1);
  if (!row) return 'no editable row';
  const sel = row.querySelector('.inst');
  const next = [...sel.options].find(o => o.value !== sel.value && o.value !== 'rain' && o.value !== 'wind');
  if (!next) return 'no alt option';
  sel.value = next.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return sel.value;
});
await wait(2400);
console.log('  换音色结果:', changed, '| 当前:', await page.evaluate(() => [...document.querySelectorAll('.mix-row .inst')].map(s => s.selectedOptions[0]?.textContent).join('/')));

// 5) 播放
console.log('→ 播放 2.5s');
await page.click('#btnPlay');
await wait(2500);
console.log('  位置:', await text('#tNow'), '| 按钮:', await page.getAttribute('#btnPlay', 'class'));
await page.click('#btnPlay');

// 6) 截图
await page.screenshot({ path: `${OUT_DIR}desktop.png`, fullPage: true });

// 7) 导出
console.log('→ 导出 WAV');
const dlP = page.waitForEvent('download', { timeout: 90000 });
await page.click('#btnWav');
const dl = await dlP;
const wavPath = `${OUT_DIR}${dl.suggestedFilename()}`;
await dl.saveAs(wavPath);
console.log('  WAV:', dl.suggestedFilename(), (fs.statSync(wavPath).size / 1048576).toFixed(2), 'MB');

console.log('→ 导出 MIDI');
const dl2P = page.waitForEvent('download', { timeout: 30000 });
await page.click('#btnMidi');
const dl2 = await dl2P;
const midPath = `${OUT_DIR}${dl2.suggestedFilename()}`;
await dl2.saveAs(midPath);
console.log('  MIDI:', dl2.suggestedFilename(), fs.statSync(midPath).size, 'bytes');

// 8) 保存 + 移动端
await page.click('#btnSave');
await wait(400);
console.log('  作品库:', await text('#libCount'));

await page.setViewportSize({ width: 390, height: 844 });
await wait(600);
await page.screenshot({ path: `${OUT_DIR}mobile.png`, fullPage: true });

console.log('\n控制台错误:', errors.length ? errors : '无');
await browser.close();
if (errors.length) process.exit(1);
console.log('✅ E2E 通过');
