# 五声工坊 · 宫商角徵羽 AI 编曲台

用 **宫 · 商 · 角 · 徵 · 羽** 五声音阶做音乐：写一句灵感，大模型挑音色，本地算法编曲，浏览器里直接弹，一键导出 WAV / MIDI。
没有音频素材文件——17 种音色全部逐采样算出来。

**在线体验**：<https://www.lukezystudio.cn/music/>

![桌面端](docs/screenshot-desktop.png)

## 两层「AI」

**语言层（可选，服务端）**：把「雨夜独处，二胡为主，加点雨声，别太吵」发给大模型，返回结构化的编曲参数——调式、主音、速度、密度、小节数、音轨配器。输出经过严格校验（角色/乐器白名单、主旋律唯一、范围钳制），按 IP 限流、同 prompt 命中缓存，任何失败都自动回退到本地规则。

**编曲层（本地，纯前端）**：

```
动机生成（五声格内受约束游走 + 拱形/上行/波浪轮廓）
  → 曲式发展（引-起-承-转-合-展-收-尾，二句模进、三句对比、四句合尾）
  → 配器（主奏 + 应答 + 铺底 + 低音进行 + 打击 + 氛围）
  → 人声化（时值/力度高斯微扰、长音颤音、倚音）
```

同一 `seed` 永远得到同一首曲子，所以分享链接能完整还原，参数也能随时改了重排。

## 功能

- **17 种音色**：古筝、二胡、琵琶、古琴、笛、箫、唢呐、埙、编钟、扬琴、锣、弦垫、低音、鼓、木鱼、雨声、风声
- **音轨台**：主旋律/副旋律/铺底/低音/打击/氛围六种角色，可加轨、删轨、换乐器、调音量、静音独奏
- **参数实时重排**：速度、密度、长度（8–48 小节）、调式、主音、种子，改完 0.4 秒内重排整首
- **五声键盘**：`A S D F G` / `Q W E R T` 演奏，`Z X` 换八度
- **钢琴卷帘**：五声音级为行、小节为列，段落色带、播放头、悬停查阶名、点击跳转
- **导出**：44.1kHz·16bit 立体声 WAV（含卷积混响，按当前静音/独奏混音），标准 SMF format 1 MIDI（每轨独立、含 GM 音色）
- **作品库**：本地保存、分享链接还原

## 声音是怎么来的

| 音色 | 合成方式 |
|---|---|
| 古筝 / 琵琶 / 古琴 | Karplus-Strong 弦模型，靠激励频谱、延迟线长度与环内滤波区分明暗与余音 |
| 二胡 | 13 次谐波锯齿波族 + 弓噪 + 520/1250Hz 鼻音共振 + 深颤音 |
| 笛 / 箫 / 埙 | 加法合成 + 气声带通 + 延迟颤音（箫更暗、气声更重） |
| 唢呐 | 奇次谐波方波族 + 1.6kHz 共振峰 + 强颤音 |
| 编钟 / 扬琴 / 锣 | 非谐分音 + 拍频 + 敲击瞬态，衰减时间各不同 |
| 弦垫 | 三路微失谐加法 + 慢包络 |
| 低音 | 奇次谐波三角波 + 拨弦包络 |
| 鼓 / 木鱼 | 下滑正弦 + 噪声瞬态 / 窄带噪声 |
| 雨声 / 风声 | 连续纹理：噪声床 + 随机雨滴 / 带通噪声 + 阵风（整段一次渲染） |

试听与导出走**同一条音频链**（离线渲染复用实时播放的音频图），下载的 WAV 就是页面上听到的那一版。

## 目录

```
public/
  index.html          页面结构
  css/style.css       水墨暗色主题
  js/theory.js        五声乐理、调式、情绪、灵感关键词
  js/rng.js           可复现随机数
  js/synth.js         合成引擎（17 音色 + 氛围纹理，纯 JS）
  js/composer.js      编曲算法（角色化音轨）
  js/player.js        Web Audio 播放 + 离线渲染
  js/wav.js           WAV 编码
  js/midi.js          MIDI 写入
  js/app.js           交互层
server/
  api.mjs             大模型编曲接口（校验 / 限流 / 缓存 / 回退）
test/
  analyze.mjs         音高、五声约束、复现性、编码自检
  e2e.mjs             Playwright 端到端：AI 生成 / 参数重排 / 加轨 / 导出
  verify_export.mjs   导出音频 ↔ 乐谱逐音符核对
```

## 本地运行

```bash
git clone https://github.com/MrLukezy/wusheng-studio.git
cd wusheng-studio
python3 -m http.server 8300 --directory public
# 打开 http://127.0.0.1:8300/  （无 API 时自动走本地规则）
```

要启用大模型：复制 `.env.example` 为 `.env` 并填入网关地址与密钥，然后

```bash
node server/api.mjs        # 监听 127.0.0.1:8311
```

nginx 把 `/music/api/` 反代到 `127.0.0.1:8311/api/` 即可（见下）。

## 测试

```bash
node test/analyze.mjs      # 合成与乐理自检（无需浏览器）

npm i -D playwright-core   # 下面两个需要浏览器
node test/e2e.mjs
BASE=https://www.lukezystudio.cn/music/ node test/verify_export.mjs
```

`verify_export.mjs` 会固定种子生成、下载 WAV，再用 Goertzel 逐个音符核对基频——目前 12/12 命中。

## 部署

```nginx
location /music/api/ {
    proxy_pass http://127.0.0.1:8311/api/;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 40s;
}
location = /music { return 308 /music/; }
location /music/ {
    alias /path/to/wusheng-studio/public/;
    index index.html;
    add_header Cache-Control "no-cache";
}
```

API 用 systemd 常驻（`wusheng-api.service`），密钥只存在服务器 `.env`，不进仓库、不下发前端。

## 已知边界

- 语言层依赖外部大模型，单次约 5–6 秒，失败会自动回退到关键词规则。
- 编曲层是规则算法：风格边界清晰、结果可复现，但不懂「淡淡的忧伤里带一点希望」这类复合语义（除非走语言层）。
- 长曲导出时离线渲染约 2–4 秒（逐采样合成）。
- 移动端卷帘为只读预览，编辑在桌面端完成。
- 作品库存 localStorage，清缓存会丢。
