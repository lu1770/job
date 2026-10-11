/**
 * 薪资解析：把各平台五花八门的写法统一成「月薪 K（千）」。
 *
 *   "20-40K·13薪"      → min 20  max 40
 *   "1.8-3万·13薪"     → min 18  max 30
 *   "30-60万/年"       → min 25  max 50   （÷12 折月）
 *   "6000-10000元"     → min 6   max 10
 *   "3万" / "15k"      → 单值
 */

const NUM = String.raw`\d+(?:\.\d+)?`;

export function parseSalary(raw) {
  const out = { minK: 0, maxK: 0, raw: raw || '' };
  if (!raw) return out;
  const s = String(raw).replace(/\s+/g, '');
  const y = s.match(new RegExp(`(${NUM})-(${NUM})万\\/年`));
  if (y) return k(+y[1] / 12, +y[2] / 12);
  const y2 = s.match(new RegExp(`(${NUM})-(${NUM})万年`));
  if (y2) return k(+y2[1] / 12, +y2[2] / 12);

  const wan = s.match(new RegExp(`(${NUM})-(${NUM})万`));
  if (wan) return k(+wan[1] * 10, +wan[2] * 10);

  const yuan = s.match(new RegExp(`(${NUM})-(${NUM})元`));
  if (yuan) return k(+yuan[1] / 1000, +yuan[2] / 1000);

  const kk = s.match(new RegExp(`(${NUM})-(${NUM})[kK]`));
  if (kk) return k(+kk[1], +kk[2]);

  const oneWan = s.match(new RegExp(`^(${NUM})万`));
  if (oneWan) return k(+oneWan[1] * 10, +oneWan[1] * 10);

  const oneK = s.match(new RegExp(`(${NUM})[kK]`));
  if (oneK) return k(+oneK[1], +oneK[1]);

  const oneYuan = s.match(new RegExp(`^(${NUM})元`));
  if (oneYuan) return k(+oneYuan[1] / 1000, +oneYuan[1] / 1000);

  return out;
}

function k(minK, maxK) {
  return { minK: round(minK), maxK: round(maxK), raw: '' };
}
function round(n) { return Math.round(n * 100) / 100; }

/** 月薪上限（K）。筛选口径统一走这里 */
export function capK(salary) { return parseSalary(salary).maxK; }

/** 万为单位的上限，便于和「≥2.5 万」这类口径比较 */
export function capWan(salary) { return round(capK(salary) / 10); }

/** 是否满足「上限 ≥ 阈值（K）」 */
export function meetsCap(salary, capKMin = 25) { return capK(salary) >= capKMin; }