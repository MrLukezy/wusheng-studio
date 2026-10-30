// 传统器乐的「技法」与「织体」知识库
// 依据检索到的民族音乐理论整理：支声复调、鱼咬尾、换头合尾、空五度、板式、八音分类。
// 这些常量既供编曲算法使用，也供前端参数面板展示说明。

/* ---------------- 八音分类（器乐材质） ---------------- */
export const BAYIN = {
  metal: { name: '金', insts: ['bianzhong', 'bianqing', 'gong', 'pengling'] },
  stone: { name: '石', insts: ['bianqing'] },
  earth: { name: '土', insts: ['xun', 'ocarina'] },
  leather: { name: '革', insts: ['drum', 'paigu'] },
  silk: { name: '丝', insts: ['guzheng', 'guqin', 'pipa', 'liuqin', 'yueqin', 'sanxian', 'ruan', 'konghou', 'erhu', 'jinghu', 'banhu', 'yangqin'] },
  wood: { name: '木', insts: ['muyu', 'bangzi'] },
  gourd: { name: '匏', insts: ['sheng', 'hulusi'] },
  bamboo: { name: '竹', insts: ['dizi', 'xiao', 'suona', 'guanzi', 'bawu'] },
};

/* ---------------- 织体 ---------------- */
export const TEXTURES = {
  heterophony: {
    id: 'heterophony', name: '支声复调', short: '支声',
    desc: '同一旋律的不同变体同时进行，中国器乐合奏的典型织体。副声部沿用主旋律骨架，只在装饰与节奏上分叉。',
  },
  homophony: {
    id: 'homophony', name: '主调织体', short: '主调',
    desc: '一条主旋律被和声声部托住，声部间节奏大致对齐，现代国风常见。',
  },
  unison: {
    id: 'unison', name: '齐奏加花', short: '齐奏',
    desc: '各声部同奏一条旋律，只在个别音上加花，最朴素也最饱满。',
  },
  layered: {
    id: 'layered', name: '分层点染', short: '分层',
    desc: '主旋律之外只留零星点音与长音铺底，留白多，近于文人音乐。',
  },
};

/* ---------------- 和声手法 ---------------- */
export const HARMONY_STYLES = {
  open5: {
    id: 'open5', name: '空五度', short: '空五度',
    desc: '只用根音与纯五度，不用三度，没有大小调的明暗指向，最有古意。',
  },
  fourth: {
    id: 'fourth', name: '四度叠置', short: '四度',
    desc: '以四度、五度叠置代替三度叠和弦，五声性色彩鲜明。',
  },
  addtone: {
    id: 'addtone', name: '加音和弦', short: '加音',
    desc: '在三度叠置上再加二度或六度音，得到带民族色彩的复合和弦。',
  },
  none: {
    id: 'none', name: '无和声', short: '单线',
    desc: '不加和声声部，只有旋律与节奏，最干净。',
  },
};

/* ---------------- 板式 ---------------- */
export const BANSHI = {
  tempoCurve: {
    id: 'tempoCurve', name: '散-慢-中-快-散', short: '板式',
    desc: '传统曲式的速度骨架：散板引子起，慢板铺陈，中板推进，快板推向高潮，散板收束。',
  },
  steady: {
    id: 'steady', name: '通体匀速', short: '匀速',
    desc: '全曲速度恒定，适合背景音乐与循环曲，不会突然变速。',
  },
  accelerando: {
    id: 'accelerando', name: '渐快', short: '渐快',
    desc: '从慢板逐步加速到快板，情绪单向推进。',
  },
};

/* ---------------- 装饰 ---------------- */
export const ORNAMENT_LEVELS = {
  plain: { id: 'plain', name: '朴素', short: '朴素', desc: '几乎不加装饰音，音与音之间直接相连，线条干净。' },
  some: { id: 'some', name: '适中', short: '适中', desc: '句尾与长音前加倚音，偶尔有经过性的加花。' },
  rich: { id: 'rich', name: '华丽', short: '华丽', desc: '大量倚音、回旋与加花，接近民间艺人的即兴演奏。' },
};

/* ---------------- 力度起伏 ---------------- */
export const DYNAMICS = {
  flat: { id: 'flat', name: '平稳', short: '平', desc: '力度变化很小，适合背景与循环。', range: 0.16 },
  natural: { id: 'natural', name: '自然', short: '自然', desc: '随乐句起伏，句首略强、句尾收弱。', range: 0.32 },
  dramatic: { id: 'dramatic', name: '戏剧', short: '戏剧', desc: '强弱对比明显，转与高潮处推到最强。', range: 0.55 },
};

/* ---------------- 混响空间 ---------------- */
export const SPACES = {
  dry: { id: 'dry', name: '近场', short: '近', desc: '几乎没有混响，听得清每个音的颗粒，适合近耳细听。', wet: 0.08, decay: 1.2 },
  hall: { id: 'hall', name: '厅堂', short: '厅', desc: '中等混响，像在一间小音乐厅里，默认。', wet: 0.24, decay: 2.4 },
  temple: { id: 'temple', name: '庙宇', short: '庙', desc: '长混响，空旷回响，适合禅意与古意。', wet: 0.42, decay: 4.2 },
  outdoor: { id: 'outdoor', name: '旷野', short: '野', desc: '混响极少但带空气感，适合大漠与风声。', wet: 0.14, decay: 2.0 },
};

/* ---------------- 曲式结构 ---------------- */
export const FORMS = {
  classical: {
    id: 'classical', name: '散慢中快散', short: '板式曲',
    desc: '传统器乐最常见的结构：散板引子、慢板、中板、快板、散板尾声。',
    plan: [['散', 0.5], ['慢', 3], ['中', 3], ['快', 3], ['散', 0.5]],
  },
  qichengzhuanhe: {
    id: 'qichengzhuanhe', name: '起承转合', short: '四句',
    desc: '四句体：起句陈述主题，承句模进，转句对比，合句回到主题收束。',
    plan: [['引', 0.5], ['起', 2], ['承', 2], ['转', 2], ['合', 2], ['尾', 0.5]],
  },
  narrative: {
    id: 'narrative', name: '叙事长卷', short: '长卷',
    desc: '多段连缀，段落较多、情绪层层推进，适合较为完整的作品。',
    plan: [['引', 0.5], ['起', 2], ['承', 2], ['转', 2], ['展', 2], ['收', 2], ['合', 2], ['尾', 0.5]],
  },
  loop: {
    id: 'loop', name: '闭环循环', short: '循环',
    desc: '首尾相接，可无缝循环播放，适合游戏与视频背景。',
    plan: [['起', 2], ['承', 2], ['转', 2], ['合', 2]],
  },
};

/* ---------------- 乐句衔接手法 ---------------- */
export const JOINTS = {
  yuyaowei: { id: 'yuyaowei', name: '鱼咬尾', desc: '下句首音沿用上句末音，句句相衔如鱼咬尾。' },
  huanTouHeWei: { id: 'huanTouHeWei', name: '换头合尾', desc: '各句开头不同，结尾归到同一落音，统一中求变化。' },
  modu: { id: 'modu', name: '模进', desc: '整句在音高上平移，形成推进。' },
  duibi: { id: 'duibi', name: '对比', desc: '音区、节奏、力度都与前句拉开。' },
};

/* ---------------- 参数元数据（前端据此渲染说明） ---------------- */
export const PARAM_DOC = {
  mode: {
    label: '调式', desc: '决定落音重心。同一组五声换主音即成不同调式，色彩随之改变。',
    options: ['宫调式 堂正', '商调式 清冽', '角调式 摇曳', '徵调式 热烈', '羽调式 幽远'],
  },
  key: { label: '主音', desc: '宫音所在音高。C 明亮朴素，D/E 略开阔，G/A 偏沉，B 最暗。' },
  bpm: { label: '速度', desc: '每分钟拍数。慢板 50–70 适合抒情，中板 80–100，快板 110 以上。' },
  density: { label: '密度', desc: '每拍出现音符的概率。低密度留白多、气口长；高密度接近民间加花演奏。' },
  bars: { label: '长度', desc: '全曲小节数，每小节 4 拍。秒数 ≈ 小节 × 240 / 速度。' },
  texture: { label: '织体', desc: '声部之间的关系。支声复调最传统，主调织体最现代，分层点染最空灵。' },
  harmony: { label: '和声', desc: '铺底声部怎么叠。空五度最古，四度叠置次之，无和声最干净。' },
  form: { label: '曲式', desc: '段落骨架。板式曲有散板引子与尾声，四句体最规整，循环体可无缝播放。' },
  banship: { label: '速度走向', desc: '整曲速度怎么变。板式有散慢中快散，匀速适合背景与循环。' },
  ornament: { label: '装饰', desc: '倚音与加花的多少。华丽接近即兴演奏，朴素则近乎一字一音。' },
  dynamics: { label: '力度', desc: '强弱起伏的幅度。戏剧性适合叙事，平稳适合背景。' },
  space: { label: '空间', desc: '混响的长短与浓淡，决定「在哪里演奏」。' },
  joint: { label: '句法', desc: '乐句之间怎么接。鱼咬尾与换头合尾是最典型的两种民族乐句关系。' },
  loop: { label: '循环曲式', desc: '去掉引子与尾声，末句落回旋音，导出即无缝循环。' },
  swing: { label: '律动', desc: '把八分音符推后半拍，得到摇曳的味道；0 为平直。' },
};

/* ---------------- 曲风的传统配器建议 ---------------- */
export const MOOD_ENSEMBLE = {
  qingya: [
    { role: 'lead', inst: 'guzheng' }, { role: 'harm', inst: 'dizi' },
    { role: 'harm', inst: 'yangqin' }, { role: 'bass', inst: 'ruan' },
  ],
  huankuai: [
    { role: 'lead', inst: 'pipa' }, { role: 'harm', inst: 'dizi' },
    { role: 'harm', inst: 'liuqin' }, { role: 'perc', inst: 'bangzi' },
    { role: 'bass', inst: 'sanxian' },
  ],
  cangliang: [
    { role: 'lead', inst: 'xun' }, { role: 'harm', inst: 'guanzi' },
    { role: 'pad', inst: 'bianzhong' }, { role: 'perc', inst: 'gong' },
    { role: 'bass', inst: 'bass' }, { role: 'amb', inst: 'wind' },
  ],
  chanyi: [
    { role: 'lead', inst: 'guqin' }, { role: 'harm', inst: 'xiao' },
    { role: 'pad', inst: 'bianqing' }, { role: 'perc', inst: 'muyu' },
    { role: 'bass', inst: 'konghou' },
  ],
  jianghu: [
    { role: 'lead', inst: 'erhu' }, { role: 'harm', inst: 'pipa' },
    { role: 'harm', inst: 'suona' }, { role: 'perc', inst: 'paigu' },
    { role: 'bass', inst: 'bass' },
  ],
  xiandai: [
    { role: 'lead', inst: 'guzheng' }, { role: 'harm', inst: 'erhu' },
    { role: 'pad', inst: 'pad' }, { role: 'perc', inst: 'drum' },
    { role: 'bass', inst: 'bass' }, { role: 'amb', inst: 'rain' },
  ],
  gongting: [
    { role: 'lead', inst: 'konghou' }, { role: 'harm', inst: 'sheng' },
    { role: 'pad', inst: 'bianzhong' }, { role: 'perc', inst: 'pengling' },
    { role: 'bass', inst: 'ruan' },
  ],
  tianyuan: [
    { role: 'lead', inst: 'hulusi' }, { role: 'harm', inst: 'dizi' },
    { role: 'harm', inst: 'liuqin' }, { role: 'bass', inst: 'yueqin' },
  ],
  beige: [
    { role: 'lead', inst: 'jinghu' }, { role: 'harm', inst: 'banhu' },
    { role: 'harm', inst: 'sanxian' }, { role: 'perc', inst: 'bangzi' },
    { role: 'bass', inst: 'ruan' },
  ],
};
