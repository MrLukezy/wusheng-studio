// Playwright 端到端：页面渲染、生成、播放、导出下载、截图
// 用法：node test/e2e.mjs   （BASE=https://... 可指向线上）
import fs from 'node:fs';
import { launch, OUT_DIR, BASE } from './_browser.mjs';

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

console.log('→ 打开', BASE);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1) 生成
console.log('→ 点击生成编曲');
await page.fill('#inspire', '月下松风，一个人走夜路');
await page.click('#btnGenerate');
await page.waitForFunction(() => document.querySelector('#title').textContent !== '还没有曲子', { timeout: 20000 });
await page.waitForTimeout(900);

const info = await page.evaluate(() => ({
  title: document.querySelector('#title').textContent,
  desc: document.querySelector('#desc').textContent,
  tempo: document.querySelector('#mTempo').textContent,
  dur: document.querySelector('#mDur').textContent,
  bars: document.querySelector('#mBars').textContent,
  notes: document.querySelector('#mNotes').textContent,
  tracks: [...document.querySelectorAll('.track .tn')].map(e => e.textContent),
  hash: location.hash,
}));
console.log('  曲目:', JSON.stringify(info));

// 2) 播放
console.log('→ 播放 2.5s');
await page.click('#btnPlay');
await page.waitForTimeout(2500);
console.log('  播放位置', await page.textContent('#tNow'));
await page.click('#btnPlay');

// 3) 截图
await page.screenshot({ path: `${OUT_DIR}desktop.png`, fullPage: true });

// 4) 导出 WAV
console.log('→ 导出 WAV');
const dlPromise = page.waitForEvent('download', { timeout: 60000 });
await page.click('#btnWav');
const dl = await dlPromise;
const wavPath = `${OUT_DIR}${dl.suggestedFilename()}`;
await dl.saveAs(wavPath);
console.log('  WAV:', dl.suggestedFilename(), (fs.statSync(wavPath).size / 1048576).toFixed(2), 'MB');

// 5) 导出 MIDI
console.log('→ 导出 MIDI');
const dl2Promise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#btnMidi');
const dl2 = await dl2Promise;
const midPath = `${OUT_DIR}${dl2.suggestedFilename()}`;
await dl2.saveAs(midPath);
console.log('  MIDI:', dl2.suggestedFilename(), fs.statSync(midPath).size, 'bytes');

// 6) 五声键盘
console.log('→ 键盘演奏');
await page.keyboard.press('a');
await page.keyboard.press('d');
await page.waitForTimeout(300);

// 7) 保存作品
await page.click('#btnSave');
await page.waitForTimeout(400);
console.log('  作品库:', await page.textContent('#libCount'));

// 8) 移动端截图
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT_DIR}mobile.png`, fullPage: true });

console.log('\n控制台错误:', errors.length ? errors : '无');
await browser.close();

if (errors.length) process.exit(1);
console.log('✅ E2E 通过');
