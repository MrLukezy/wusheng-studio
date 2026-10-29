// 可复现的伪随机数（mulberry32）+ 字符串哈希
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
    this._f = mulberry32(this.seed || 1);
  }
  next() { return this._f(); }
  range(a, b) { return a + (b - a) * this._f(); }
  int(n) { return Math.floor(this._f() * n); }
  pick(arr) { return arr[Math.floor(this._f() * arr.length)]; }
  chance(p) { return this._f() < p; }
  // 近似高斯（Irwin–Hall），用于人性化的力度/时值微扰
  gauss() { return (this._f() + this._f() + this._f() + this._f() - 2) * 0.75; }
  weighted(items) {
    // items: [{w:number, ...}] -> 选中项
    let total = 0;
    for (const it of items) total += it.w;
    let r = this._f() * total;
    for (const it of items) { r -= it.w; if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
