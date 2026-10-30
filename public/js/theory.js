// 五声乐理：宫商角徵羽
export const SR = 44100;

export const DEGREES = ['宫', '商', '角', '徵', '羽'];
export const DEGREE_SEMIS = [0, 2, 4, 7, 9];      // 相对宫音的半音数
export const JIANPU = ['1', '2', '3', '5', '6'];   // 简谱
export const GONGCHE = ['上', '尺', '工', '六', '五']; // 工尺谱（正声）

export const KEYS = [
  { name: 'C', midi: 60 }, { name: 'D', midi: 62 }, { name: 'E', midi: 64 },
  { name: 'F', midi: 65 }, { name: 'G', midi: 67 }, { name: 'A', midi: 69 },
  { name: 'B', midi: 71 },
];

// 调式：主音落在五声的第几个音上（宫调式=宫为主音……）
export const MODES = [
  { name: '宫调式', tonic: 0, mood: '堂正、明亮，五声之本' },
  { name: '商调式', tonic: 1, mood: '清冽、带一点秋意' },
  { name: '角调式', tonic: 2, mood: '柔和、摇曳，近小调' },
  { name: '徵调式', tonic: 3, mood: '热烈、开阔' },
  { name: '羽调式', tonic: 4, mood: '幽远、含蓄，近小调' },
];

export function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

// 把「音级步进」映射为 MIDI：step 0 = 该八度的宫音
// 支持负数与跨八度，例如 step=5 -> 高八度宫
export function stepToMidi(step, rootMidi) {
  const oct = Math.floor(step / 5);
  const d = ((step % 5) + 5) % 5;
  return rootMidi + 12 * oct + DEGREE_SEMIS[d];
}
export function stepDegree(step) { return ((step % 5) + 5) % 5; }
export function stepOctave(step) { return Math.floor(step / 5); }

// 在五声音阶内的音程（以音级步数计）
export function stepName(step) {
  const d = stepDegree(step);
  const oct = stepOctave(step);
  return DEGREES[d] + (oct > 0 ? '·'.repeat(Math.min(oct, 2)) : oct < 0 ? ',' : '');
}

export function jianpu(step) {
  const d = stepDegree(step), oct = stepOctave(step);
  let s = JIANPU[d];
  if (oct > 0) s = s + '˙'.repeat(Math.min(oct, 2));
  if (oct < 0) s = s + '̣';
  return s;
}

// 中文音名，如 宫· / 羽
export function cnNote(step, rootName) {
  return `${rootName}${stepDegree(step) === 0 ? '' : ''}${DEGREES[stepDegree(step)]}${stepOctave(step) ? (stepOctave(step) > 0 ? '↑' : '↓') : ''}`;
}

export const MOODS = [
  {
    id: 'qingya', name: '清雅', desc: '古筝与笛，江南雨巷',
    bpm: 68, density: 0.55, swing: 0, drums: 0.12, ornaments: 0.5,
    palette: ['guzheng', 'dizi', 'xun', 'bass'],
    prog: [[0, 4, 1, 0], [0, 2, 4, 1], [4, 0, 1, 2]],
    color: '#7fc8b0',
  },
  {
    id: 'huankuai', name: '欢快', desc: '跳脱的节奏，春日踏歌',
    bpm: 108, density: 0.82, swing: 0, drums: 0.7, ornaments: 0.35,
    palette: ['guzheng', 'dizi', 'drum', 'bass'],
    prog: [[0, 3, 4, 0], [0, 4, 3, 4], [3, 0, 4, 0]],
    color: '#e8b85f',
  },
  {
    id: 'cangliang', name: '苍凉', desc: '埙声与大漠，风起',
    bpm: 58, density: 0.36, swing: 0, drums: 0.08, ornaments: 0.75,
    palette: ['xun', 'bianzhong', 'bass', 'pad'],
    prog: [[0, 2, 1, 0], [4, 2, 0, 0], [1, 0, 2, 0]],
    color: '#c88a6a',
  },
  {
    id: 'chanyi', name: '禅意', desc: '一钟一磬，留白极多',
    bpm: 52, density: 0.26, swing: 0, drums: 0.16, ornaments: 0.2,
    palette: ['bianzhong', 'xun', 'pad', 'bass'],
    prog: [[0, 0, 4, 0], [0, 4, 0, 0], [0, 1, 0, 0]],
    color: '#9fb6d9',
  },
  {
    id: 'jianghu', name: '江湖', desc: '刀光剑影，鼓点催人',
    bpm: 92, density: 0.74, swing: 0, drums: 0.85, ornaments: 0.45,
    palette: ['guzheng', 'drum', 'bass', 'dizi'],
    prog: [[0, 4, 2, 3], [0, 2, 3, 0], [3, 4, 0, 0]],
    color: '#d98c8c',
  },
  {
    id: 'xiandai', name: '现代', desc: '五声入电，夜色与霓虹',
    bpm: 96, density: 0.68, swing: 0.08, drums: 0.78, ornaments: 0.15,
    palette: ['pad', 'bass', 'drum', 'guzheng'],
    prog: [[0, 4, 1, 3], [4, 0, 3, 0], [1, 4, 0, 0]],
    color: '#a99bf0',
  },
  {
    id: 'gongting', name: '宫廷', desc: '钟磬笙篌，雅乐庄重',
    bpm: 56, density: 0.32, swing: 0, drums: 0.22, ornaments: 0.28,
    palette: ['bianzhong', 'sheng', 'konghou', 'pengling'],
    prog: [[0, 0, 3, 0], [0, 3, 0, 0], [0, 4, 3, 0]],
    color: '#d9c07a',
  },
  {
    id: 'tianyuan', name: '田园', desc: '葫芦丝与笛，山水明快',
    bpm: 84, density: 0.6, swing: 0, drums: 0.3, ornaments: 0.42,
    palette: ['hulusi', 'dizi', 'liuqin', 'yueqin'],
    prog: [[0, 3, 4, 0], [0, 4, 3, 0], [3, 0, 4, 0]],
    color: '#8fc9a0',
  },
  {
    id: 'beige', name: '北歌', desc: '京胡板胡，高亢苍劲',
    bpm: 88, density: 0.62, swing: 0, drums: 0.55, ornaments: 0.5,
    palette: ['jinghu', 'banhu', 'sanxian', 'bangzi'],
    prog: [[0, 2, 3, 0], [0, 3, 2, 0], [3, 2, 0, 0]],
    color: '#e06b5e',
  },
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map(m => [m.id, m]));

// 关键词 → 情绪 / 主音 / 调式 的轻量「灵感解析」
const KEYWORD_MOOD = [
  { re: /禅|空|静|寂|月下|山寺|钟|茶|无我|发呆|冥想/, mood: 'chanyi' },
  { re: /欢|喜|春|花|跳|节日|童|奔跑|阳光|热闹/, mood: 'huankuai' },
  { re: /悲|离|秋|寒|苍|雪|孤|荒|大漠|别|泪/, mood: 'cangliang' },
  { re: /江湖|剑|侠|风|刀|酒|战|马蹄|恩仇/, mood: 'jianghu' },
  { re: /夜|霓虹|城|雨|电|赛博|梦|lofi|咖啡|街/, mood: 'xiandai' },
  { re: /江南|诗|雨巷|青瓷|墨|书|画|竹|舟|清/, mood: 'qingya' },
  { re: /宫廷|雅乐|祭祀|庄严|肃穆|庙堂|朝|古典|编钟/, mood: 'gongting' },
  { re: /田园|山歌|牧|田野|梯田|农家|葫芦丝|傣|乡/, mood: 'tianyuan' },
  { re: /京剧|秦腔|梆子|北方|黄土|高亢|西北|板胡/, mood: 'beige' },
];
const KEYWORD_KEY = [
  { re: /月|夜|幽|影|静/, key: 'A' },
  { re: /春|花|喜|欢/, key: 'D' },
  { re: /秋|雪|寒|苍/, key: 'G' },
  { re: /江|河|风|舟/, key: 'E' },
  { re: /山|石|钟|寺/, key: 'C' },
  { re: /梦|星|云|空/, key: 'F' },
];
const KEYWORD_MODE = [
  { re: /幽|思|夜|离|悲|梦/, mode: 4 },   // 羽
  { re: /清|雅|淡|静|水/, mode: 2 },      // 角
  { re: /热|烈|欢|盛|阳/, mode: 3 },      // 徵
  { re: /秋|凉|远|客/, mode: 1 },         // 商
  { re: /堂|正|礼|钟/, mode: 0 },         // 宫
];

export function analyzeInspiration(text = '') {
  const t = (text || '').toLowerCase();
  const hit = (arr, field) => {
    for (const k of arr) if (k.re.test(t)) return k[field];
    return null;
  };
  return {
    mood: hit(KEYWORD_MOOD, 'mood'),
    key: hit(KEYWORD_KEY, 'key'),
    mode: hit(KEYWORD_MODE, 'mode'),
    tags: KEYWORD_MOOD.filter(k => k.re.test(t)).length,
  };
}

const TITLE_A = ['松风', '寒潭', '月下', '孤舟', '春溪', '云外', '雪落', '青瓷', '空山', '长街', '烛影', '雁回'];
const TITLE_B = ['引', '行', '谣', '调', '令', '曲', '吟', '操', '慢', '序'];

export function makeTitle(moodId, rng) {
  const base = {
    qingya: ['江南', '雨巷', '青竹', '荷风'],
    huankuai: ['踏歌', '春嬉', '花朝', '风铃'],
    cangliang: ['大漠', '孤雁', '残阳', '霜天'],
    chanyi: ['空山', '禅院', '一炷', '云水'],
    jianghu: ['刀影', '孤城', '走马', '烈酒'],
    xiandai: ['霓虹', '夜行', '雨幕', '电波'],
  }[moodId] || TITLE_A;
  const a = rng.pick(base);
  const b = rng.chance(0.55) ? rng.pick(TITLE_B) : rng.pick(TITLE_A);
  return a + b;
}
