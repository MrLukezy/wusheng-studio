// 统一的浏览器启动器：优先用项目依赖的 playwright-core，
// 找不到时回退到常见安装位置；浏览器可执行文件支持 CHROME_PATH 覆盖。
import fs from 'node:fs';

let mod;
try {
  mod = await import('playwright-core');
} catch {
  console.error('缺少 playwright-core，先执行：npm i -D playwright-core');
  process.exit(1);
}
// playwright-core 是 CJS，命名导出不一定可用
const chromium = mod.chromium || mod.default?.chromium;

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/local/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export async function launch() {
  const exe = CANDIDATES.find(p => fs.existsSync(p));
  return chromium.launch({
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    ...(exe ? { executablePath: exe } : {}),
  });
}

export const OUT_DIR = new URL('./out/', import.meta.url).pathname;
export const BASE = process.env.BASE || 'http://127.0.0.1:8300/';
