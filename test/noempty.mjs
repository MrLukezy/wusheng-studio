// 段落充实度检查：所有曲风 × 种子 × 篇幅 × 密度的笛卡尔积，不允许出现空小节
// 段落充实度检查：任何曲风、任何种子，都不允许出现空小节
import { compose } from '../public/js/composer.js';
import { MOODS } from '../public/js/theory.js';

let fail = 0, cases = 0, worst = null;
for (const m of MOODS) {
  for (const seed of [1, 7, 42, 99, 2024, 88888]) {
    for (const bars of [8, 12, 20, 28, 48]) {
      for (const density of [0.15, 0.35, 0.6, 0.9]) {
        cases++;
        const p = compose({ mood: m.id, mode: seed % 5, key: 'D', bpm: 80, density, bars, seed });
        const per = new Array(p.meta.bars).fill(0);
        for (const n of p.notes) {
          if (n.step == null) continue;
          const b = Math.floor(n.t / 4);
          if (b >= 0 && b < per.length) per[b]++;
        }
        const empty = per.map((c, i) => c === 0 ? i + 1 : null).filter(Boolean);
        // 末尾小节允许只有长音（1 个），不算空
        const realEmpty = empty.filter(b => per[b - 1] === 0 && !p.notes.some(n => Math.floor(n.t / 4) === b - 1 && n.dur >= 2));
        if (empty.length) {
          fail++;
          if (!worst || empty.length > worst.n) worst = { n: empty.length, mood: m.name, seed, bars, density, empty };
        }
      }
    }
  }
}
console.log(`共 ${cases} 组参数，出现空小节的 ${fail} 组`);
if (worst) console.log('最差:', JSON.stringify(worst));
console.log(fail === 0 ? '✅ 无空小节' : `⚠️ ${fail} 组存在空小节`);
process.exit(fail === 0 ? 0 : 1);
