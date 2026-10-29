// 五声工坊 · 编曲 API
// 把「一句灵感」交给大模型，返回结构化的五声编曲参数。
// 设计要点：密钥只在服务端；按 IP 限流；同 prompt 命中缓存；输出严格校验。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8311);
const HOST = '127.0.0.1';

/* ---------------- 配置 ---------------- */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = { ...loadEnv(), ...process.env };
const LLM_BASE = ENV.MUSIC_LLM_BASE || '';
const LLM_KEY = ENV.MUSIC_LLM_KEY || '';
const LLM_MODEL = ENV.MUSIC_LLM_MODEL || 'claude-sonnet-4-6';
const ENABLED = !!(LLM_BASE && LLM_KEY);

const MOODS = ['qingya', 'huankuai', 'cangliang', 'chanyi', 'jianghu', 'xiandai'];
const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ROLES = ['lead', 'harm', 'pad', 'bass', 'perc', 'amb'];
const INSTS = ['guzheng', 'erhu', 'pipa', 'guqin', 'dizi', 'xiao', 'suona', 'xun',
  'bianzhong', 'yangqin', 'gong', 'pad', 'bass', 'drum', 'muyu', 'rain', 'wind'];
const AMB = ['rain', 'wind'];
const PERC = ['drum', 'muyu', 'gong'];

/* ---------------- 限流 / 缓存 ---------------- */
const HITS = new Map();       // ip -> [timestamps]
const CACHE = new Map();      // hash -> {at, data}
const LIMIT_PER_HOUR = Number(ENV.MUSIC_LLM_LIMIT || 10);
const DAILY_CAP = Number(ENV.MUSIC_LLM_DAILY || 400);
let dayKey = new Date().toISOString().slice(0, 10);
let dayCount = 0;
let inflight = 0;

function allow(ip) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; dayCount = 0; }
  if (dayCount >= DAILY_CAP) return { ok: false, msg: '今日 AI 额度已用完，请稍后再试' };
  const arr = (HITS.get(ip) || []).filter(t => now - t < 3600e3);
  if (arr.length >= LIMIT_PER_HOUR) return { ok: false, msg: `每 IP 每小时最多 ${LIMIT_PER_HOUR} 次 AI 编曲` };
  arr.push(now); HITS.set(ip, arr);
  return { ok: true };
}

/* ---------------- 提示词 ---------------- */
const SYSTEM = `你是中国五声音阶（宫商角徵羽）编曲助手。根据用户描述设计一首曲子的参数，只输出 JSON。
字段与取值：
- title：2~5 个汉字曲名
- mood：qingya(清雅)|huankuai(欢快)|cangliang(苍凉)|chanyi(禅意)|jianghu(江湖)|xiandai(现代)
- mode：0宫 1商 2角 3徵 4羽（决定落音重心；羽、角偏暗，徵、宫偏亮）
- key：C|D|E|F|G|A|B
- bpm：40~160 整数
- density：0.1~1 小数（音符密度）
- bars：8~48 整数（每小节 4 拍，秒数 ≈ bars×240/bpm）
- tracks：2~5 项，每项 {"role":..,"inst":..}
  role 只能是 lead(主旋律,必须有且仅一个)|harm(副旋律)|pad(铺底)|bass(低音)|perc(打击)|amb(氛围)
  inst 从 guzheng古筝,erhu二胡,pipa琵琶,guqin古琴,dizi笛,xiao箫,suona唢呐,xun埙,bianzhong编钟,yangqin扬琴,gong锣,pad弦垫,bass低音,drum鼓,muyu木鱼,rain雨声,wind风声 中选
  约束：amb 只能用 rain/wind；perc 只能用 drum/muyu/gong
- reason：一句不超过 30 字的中文说明，解释你的选择
建议：安静/氛围类曲子至少保留一个低频（bass 或 pad）撑住底子；欢快/江湖类可加 perc；只有明确需要时才用 amb。
只输出 JSON，不要 markdown 代码块，不要解释。`;

function userPrompt(prompt) {
  return `用户描述：${prompt}\n请给出编曲参数 JSON。`;
}

/* ---------------- 模型调用 ---------------- */
async function callLLM(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(LLM_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(prompt) }],
        temperature: 0.5,
        max_tokens: 600,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`上游 ${res.status}`);
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  out.title = String(raw.title || '').replace(/[《》\s]/g, '').slice(0, 8) || '无题';
  out.mood = MOODS.includes(raw.mood) ? raw.mood : 'qingya';
  out.mode = Number.isFinite(+raw.mode) ? clamp(Math.round(+raw.mode), 0, 4) : 0;
  out.key = KEYS.includes(raw.key) ? raw.key : 'C';
  out.bpm = clamp(Math.round(+raw.bpm || 70), 40, 160);
  out.density = clamp(+raw.density || 0.5, 0.1, 1);
  out.bars = clamp(Math.round(+raw.bars || 20), 8, 48);
  out.reason = String(raw.reason || '').slice(0, 60);

  const tracks = [];
  const seen = new Set();
  for (const t of Array.isArray(raw.tracks) ? raw.tracks : []) {
    if (!t) continue;
    const role = ROLES.includes(t.role) ? t.role : null;
    const inst = INSTS.includes(t.inst) ? t.inst : null;
    if (!role || !inst) continue;
    if (role === 'lead' && seen.has('lead')) continue;
    if (role !== 'amb' && AMB.includes(inst)) continue;
    if (role === 'amb' && !AMB.includes(inst)) continue;
    if (role === 'perc' && !PERC.includes(inst)) continue;
    seen.add(role);
    tracks.push({ role, inst });
    if (tracks.length >= 5) break;
  }
  if (!tracks.some(t => t.role === 'lead')) tracks.unshift({ role: 'lead', inst: 'guzheng' });
  out.tracks = tracks;
  return out;
}

/* ---------------- APK 元信息（给 agent 用） ---------------- */
const APK_DIR = path.join(ROOT, 'public', 'apk');
const SITE = ENV.MUSIC_SITE || 'https://www.lukezystudio.cn/music';

function readApkInfo() {
  const dir = APK_DIR;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.apk')) : [];
  if (!files.length) return null;
  const apk = files[0];
  const full = path.join(dir, apk);
  const buf = fs.readFileSync(full);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let manifest = {};
  const vj = path.join(dir, 'version.json');
  if (fs.existsSync(vj)) {
    try { manifest = JSON.parse(fs.readFileSync(vj, 'utf8')); } catch { }
  }
  const stat = fs.statSync(full);
  return {
    app: '五声工坊',
    package: 'com.lukezy.wusheng',
    fileName: apk,
    versionName: manifest.versionName || '1.0.0',
    versionCode: manifest.versionCode || 1,
    minSdk: manifest.minSdk || 23,
    targetSdk: 34,
    sizeBytes: buf.length,
    sha256: sha,
    lastModified: stat.mtime.toISOString(),
    downloadUrl: `${SITE}/apk/${apk}`,
    checkUrl: `${SITE}/apk/version.json`,
    releaseNotes: manifest.notes || '',
  };
}

const APK_DOC = {
  hotUpdate: {
    web: true,
    note: '页面内容全部来自服务端，平台更新后 App 打开即最新，不需要重新安装 APK。',
    apkUpgrade: '仅当外壳能力变化（下载、音频、菜单等）时才需要换 APK；App 启动会拉 version.json 比对 versionCode。',
  },
  install: [
    '下载 APK 到手机',
    '允许「安装未知来源应用」',
    '打开安装，首次启动即为最新页面',
  ],
  endpoints: [
    { method: 'GET', path: '/music/api/apk', desc: '查询 APK 版本、大小、sha256、下载直链（本响应）' },
    { method: 'GET', path: '/music/api/apk/version', desc: 'App 内检查更新用的精简格式' },
    { method: 'GET', path: '/music/apk/wusheng-studio.apk', desc: 'APK 二进制下载（application/vnd.android.package-archive）' },
    { method: 'GET', path: '/music/apk/version.json', desc: '静态版本清单，无需服务进程，适合离线镜像' },
    { method: 'POST', path: '/music/api/arrange', desc: 'AI 编曲：{prompt} → 调式/速度/配器' },
    { method: 'GET', path: '/music/api/health', desc: '服务健康检查与今日额度' },
  ],
};

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };

  if (req.method === 'GET' && (req.url === '/api/apk' || req.url === '/api/apk/')) {
    const info = readApkInfo();
    if (!info) return send(404, { ok: false, error: '尚未发布 APK' });
    return send(200, { ok: true, ...info, ...APK_DOC });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/apk/version')) {
    const info = readApkInfo();
    if (!info) return send(404, { ok: false, error: '尚未发布 APK' });
    return send(200, {
      versionCode: info.versionCode,
      versionName: info.versionName,
      url: info.downloadUrl,
      sizeBytes: info.sizeBytes,
      sha256: info.sha256,
      notes: info.releaseNotes,
    });
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    return send(200, { ok: true, enabled: ENABLED, model: ENABLED ? LLM_MODEL : null, today: dayCount, cap: DAILY_CAP });
  }
  if (req.method !== 'POST' || !req.url.startsWith('/api/arrange')) return send(404, { ok: false, error: 'not found' });
  if (!ENABLED) return send(503, { ok: false, error: 'AI 未配置', fallback: true });

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) { return send(413, { ok: false, error: '请求过大' }); }
  }
  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'JSON 解析失败' }); }

  const prompt = String(payload.prompt || '').trim().slice(0, 200);
  if (prompt.length < 2) return send(400, { ok: false, error: '描述太短' });

  // 取 nginx 追加的最后一跳，避免客户端伪造 X-Forwarded-For 绕过限流
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const ip = String(req.headers['x-real-ip'] || xff.pop() || req.socket.remoteAddress || 'unknown');
  const hash = crypto.createHash('sha1').update(`${LLM_MODEL}|${prompt}`).digest('hex');

  const hit = CACHE.get(hash);
  if (hit) return send(200, { ok: true, cached: true, source: 'llm', data: hit.data });

  const gate = allow(ip);
  if (!gate.ok) return send(429, { ok: false, error: gate.msg, fallback: true });
  if (inflight >= 2) return send(429, { ok: false, error: 'AI 正忙，请稍后再试', fallback: true });

  inflight++;
  const t0 = Date.now();
  try {
    const text = await callLLM(prompt);
    const data = sanitize(extractJSON(text));
    if (!data) return send(502, { ok: false, error: '模型返回格式异常', fallback: true });
    dayCount++;
    CACHE.set(hash, { at: Date.now(), data });
    if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
    console.log(`[arrange] ${Date.now() - t0}ms ip=${ip.slice(0, 12)} prompt=${prompt.slice(0, 24)}`);
    return send(200, { ok: true, cached: false, source: 'llm', ms: Date.now() - t0, data });
  } catch (e) {
    console.error('[arrange] fail', e.message);
    return send(502, { ok: false, error: 'AI 调用失败：' + e.message, fallback: true });
  } finally {
    inflight--;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`wusheng api on http://${HOST}:${PORT} | llm=${ENABLED ? LLM_MODEL : 'disabled'}`);
});
