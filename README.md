# 五声工坊 · 宫商角徵羽 AI 编曲台

用 **宫 · 商 · 角 · 徵 · 羽** 五声音阶做音乐：浏览器里直接弹、算法编曲、一键导出 WAV / MIDI。
纯前端，没有任何音频素材文件——所有声音都是逐采样算出来的。

**在线体验**：<https://www.lukezystudio.cn/music/>

![桌面端](docs/screenshot-desktop.png)

## 功能

- **五声音色**：古筝、笛、埙、编钟、弦垫、低音、鼓、木鱼，全部实时合成
- **五声键盘**：`A S D F G` / `Q W E R T` 演奏，`Z X` 换八度
- **AI 编曲**：一句灵感文字 → 情绪/调式/配器 → 整首曲子（引·起·承·转·合·尾）
- **钢琴卷帘**：五声音级为行、小节为列，段落色带、播放头、悬停查阶名、点击跳转
- **分轨控制**：主旋律 / 副旋律 / 铺底 / 低音 / 打击，可静音、独奏
- **导出**：44.1kHz·16bit 立体声 WAV（含混响），标准 SMF format 1 MIDI（五轨独立）
- **作品库**：本地保存、分享链接还原（seed 决定一切）

## 声音是怎么来的

| 音色 | 合成方式 |
|---|---|
| 古筝 | Karplus-Strong 弦模型（环形延迟线 + 环内平均滤波）+ 琴体双共振峰 + 指甲触弦噪声 |
| 笛 | 7 次谐波加法合成 + 气声带通 + 延迟颤音 |
| 埙 | 近正弦叠加 + 慢起音 + 气息噪声 |
| 编钟 | 6 个非谐分音 + 拍频 + 敲击瞬态 |
| 弦垫 | 三路微失谐加法 + 慢包络 |
| 低音 | 奇次谐波三角波 + 拨弦包络 |
| 鼓 / 木鱼 | 下滑正弦 + 噪声瞬态 / 窄带噪声 |

试听与导出走**同一条音频链**（`OfflineAudioContext` 与实时播放共用音频图），所以下载的 WAV 就是页面上听到的那一版。

## 编曲算法

```
灵感文字 → 关键词解析（情绪/主音/调式）
        → 动机生成（五声格内受约束随机游走 + 拱形/上行/波浪轮廓）
        → 曲式发展（引-起-承-转-合-尾，二句模进、三句对比、四句合尾）
        → 配器（主奏 + 应答 + 低音进行 + 打击）
        → 人声化（时值/力度高斯微扰、长音颤音、倚音）
```

这是**规则驱动的生成式算法，不是神经网络**：不需要 API、离线可用、同一 `seed` 永远得到同一首曲子，因此分享链接能完整还原。五种调式改变落音重心，六种情绪改变速度、密度、配器与和声进行。

## 目录

```
public/
  index.html          页面结构
  css/style.css       水墨暗色主题
  js/theory.js        五声乐理、调式、情绪、灵感关键词
  js/rng.js           可复现随机数
  js/synth.js         合成引擎（纯 JS，Node 也能跑）
  js/composer.js      编曲算法
  js/player.js        Web Audio 播放 + 离线渲染
  js/wav.js           WAV 编码
  js/midi.js          MIDI 写入
  js/app.js           交互层
test/
  analyze.mjs         Node 自检：音高、五声约束、复现性、编码
  e2e.mjs             Playwright 端到端：生成/播放/导出/截图
  verify_export.mjs   导出音频 ↔ 乐谱逐音符核对
```

## 本地运行

纯静态，任意静态服务器即可：

```bash
git clone https://github.com/MrLukezy/wusheng-studio.git
cd wusheng-studio
python3 -m http.server 8300 --directory public
# 打开 http://127.0.0.1:8300/
```

## 测试

```bash
node test/analyze.mjs      # 合成与乐理自检（无需浏览器）

npm i -D playwright-core   # 下面两个需要浏览器
node test/e2e.mjs
BASE=https://www.lukezystudio.cn/music/ node test/verify_export.mjs
```

`verify_export.mjs` 会固定种子生成、下载 WAV，再用 Goertzel 逐个音符核对基频——目前 12/12 命中。

## 部署

nginx 静态站点：

```nginx
location = /music { return 308 /music/; }
location /music/ {
    alias /path/to/wusheng-studio/public/;
    index index.html;
    add_header Cache-Control "no-cache";
}
```

## 已知边界

- 编曲是规则算法：风格边界清晰，但听不懂「淡淡的忧伤里带一点希望」这类复合语义。
- 长曲导出时离线渲染约 2–4 秒（逐采样合成）。
- 移动端卷帘为只读预览，编辑在桌面端完成。
- 作品库存 localStorage，清缓存会丢。
