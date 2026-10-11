// 职位描述「年龄限制」探测器（共享模块）
// 用法：import { detectAgeLimit } from './age.mjs';
// 返回 null（无年龄限制）或 { hit, kind, ctx } —— hit 为命中的原始片段。

// 只把「针对年龄本身的不限」视为无限制（如「年龄不限」「不限年龄」），
// 不能因为「男女不限」「学历不限」等就把整段判为无限制。
const NEG = /(年龄\s*(不限|无要求|不要求|不作要求|无限制|无特殊要求|无硬性要求))|((不限|无)\s*年龄)/;

// 各条命中规则
const RULES = [
  // 25-35岁 / 25—35周岁 / 25~35 岁
  { kind: 'range', re: /(\d{2})\s*[-~—－–～到至]\s*(\d{2})\s*(岁|周岁)/g },
  // 年龄：25-35（无“岁”字）
  { kind: 'range_nounit', re: /年龄[^。；;\n，,]{0,8}?(\d{2})\s*[-~—－–～到至]\s*(\d{2})/g },
  // 年龄35岁 / 年龄：35周岁 / 年龄在28岁
  { kind: 'age_word', re: /年龄[^。；;\n，,]{0,10}?(\d{2})\s*(岁|周岁)/g },
  // 不超过35岁 / 低于40周岁
  { kind: 'bound', re: /(不超过|不高于|不能超过|不得超过|不超|低于|小于|大于|高于)\s*(\d{2})\s*(岁|周岁)/g },
  // 35岁以下 / 40周岁以内 / 35岁左右
  { kind: 'bound_suffix', re: /(\d{2})\s*(岁|周岁)\s*(以下|以内|之内|之上|以上|左右|上下|出头)/g },
  // 裸 "35岁"（排除 35岁薪 / 35k 之类无关写法）
  { kind: 'bare', re: /(\d{2})\s*(岁|周岁)(?!\s*(薪|k|K|万|人))/g },
  // 出生年代写法：90后 / 85后 / 95后 / 00后（排除 后端/以后/之后/后续/后台/后面）
  { kind: 'birth_decade', re: /((?:[7-9]\d|0\d)\s*后)(?![端续台面期])/g },
  // 出生年份写法：1985年以后出生 / 出生年份1985
  { kind: 'birth_year', re: /(\d{4})\s*年\s*(?:以后|之后|后)?\s*出生/g },
  { kind: 'birth_year2', re: /出生[^。；;\n，,]{0,8}?(\d{4})/g },
  { kind: 'birth_year3', re: /年龄[^。；;\n，,]{0,8}?(\d{4})\s*年/g },
];

export function detectAgeLimit(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ');
  for (const { kind, re } of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = Math.max(0, m.index - 6);
      const e = Math.min(t.length, m.index + m[0].length + 6);
      const win = t.slice(s, e);
      if (NEG.test(win)) continue; // 「年龄不限」类表述，跳过
      const nums = m[0].match(/\d+/g) || [];
      let ok;
      if (kind === 'birth_year' || kind === 'birth_year2' || kind === 'birth_year3') {
        ok = nums.some((n) => n.length === 4 && +n >= 1940 && +n <= 2015);
      } else if (kind === 'birth_decade') {
        ok = nums.some((n) => +n >= 0 && +n <= 99);
      } else {
        const y = m[0].match(/\d{2}/g) || [];
        ok = y.length > 0 && y.every((n) => +n >= 16 && +n <= 70);
      }
      if (ok) {
        return { hit: m[0].trim(), kind, ctx: win };
      }
    }
  }
  return null;
}

export function isAgeLimited(text) {
  return !!detectAgeLimit(text);
}
