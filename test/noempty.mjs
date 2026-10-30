// 段落充实度：判断每个小节是否被任何音符「覆盖」（含长音跨越），
// 而不是只看音符起点落哪——铺底长音会让后续小节被误判为空。
import { compose } from '../public/js/composer.js';
import { MOODS } from '../public/js/theory.js';

let cases = 0, fail = 0;
const worst = [];

const textures = ['heterophony', 'homophony', 'unison', 'layered'];
const harmonies = ['open5', 'fourth', 'addtone'];
const forms = ['classical', 'qichengzhuanhe', 'narrative'];
const orns = ['plain', 'some', 'rich'];

for (const m of MOODS) {
  for (const seed of [1, 7, 42, 2024]) {
    for (const bars of [8, 12, 20, 28]) {
      for (const density of [0.2, 0.5, 0.85]) {
        cases++;
        const texture = textures[(seed + bars) % textures.length];
        const harmony = harmonies[(seed + bars) % harmonies.length];
        const form = forms[(seed + bars) % forms.length];
        const ornament = orns[(seed + bars) % orns.length];
        const p = compose({ mood: m.id, mode: seed % 5, key: 'D', bpm: 80, density, bars, seed, texture, harmony, form, ornament });
        // 覆盖式统计：音符 [t, t+dur) 覆盖到的每个小节都算有内容
        const cover = new Array(p.meta.bars).fill(0);
        for (const n of p.notes) {
          if (n.step == null) continue;
          const b0 = Math.floor(n.t / 4);
          const b1 = Math.floor((n.t + Math.max(0.4, n.dur)) / 4);
          for (let b = Math.max(0, b0); b <= Math.min(cover.length - 1, b1); b++) cover[b]++;
        }
        const empty = cover.map((c, i) => c === 0 ? i + 1 : null).filter(Boolean);
        if (empty.length) {
          fail++;
          if (worst.length < 5) worst.push({ mood: m.name, seed, bars, density, texture, form, empty });
        }
      }
    }
  }
}
console.log(`共 ${cases} 组参数，存在空小节 ${fail} 组`);
worst.forEach(w => console.log('  ✗', JSON.stringify(w)));
console.log(fail === 0 ? '✅ 无空小节' : `⚠️ ${fail} 组有空小节`);
process.exit(fail === 0 ? 0 : 1);
