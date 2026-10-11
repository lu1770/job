/**
 * 年龄限制探测器：JD 正文含年龄限制的条目一律剔除，不投递。
 * 「年龄不限 / 不限年龄」视为无限制。
 */
const NEG = /(年龄\s*(不限|无要求|不要求|不作要求|无限制|无特殊要求|无硬性要求))|((不限|无)\s*年龄)/;

const RULES = [
  { kind: 'range', re: /(\d{2})\s*[-~—－–～到至]\s*(\d{2})\s*(岁|周岁)/g },
  { kind: 'range_nounit', re: /年龄[^。；;\n，,]{0,8}?(\d{2})\s*[-~—－–～到至]\s*(\d{2})/g },
  { kind: 'age_word', re: /年龄[^。；;\n，,]{0,10}?(\d{2})\s*(岁|周岁)/g },
  { kind: 'bound', re: /(不超过|不高于|不能超过|不得超过|不超|低于|小于|大于|高于)\s*(\d{2})\s*(岁|周岁)/g },
  { kind: 'bound_suffix', re: /(\d{2})\s*(岁|周岁)\s*(以下|以内|之内|之上|以上|左右|上下|出头)/g },
  { kind: 'bare', re: /(\d{2})\s*(岁|周岁)(?!\s*(薪|k|K|万|人))/g },
  { kind: 'birth_decade', re: /((?:[7-9]\d|0\d)\s*后)(?![端续台面期])/g },
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
      const win = t.slice(Math.max(0, m.index - 6), Math.min(t.length, m.index + m[0].length + 6));
      if (NEG.test(win)) continue;
      const nums = m[0].match(/\d+/g) || [];
      let ok;
      if (kind.startsWith('birth_year')) ok = nums.some((n) => n.length === 4 && +n >= 1940 && +n <= 2015);
      else if (kind === 'birth_decade') ok = nums.some((n) => +n >= 0 && +n <= 99);
      else ok = (m[0].match(/\d{2}/g) || []).every((n) => +n >= 16 && +n <= 70);
      if (ok) return { hit: m[0].trim(), kind, ctx: win };
    }
  }
  return null;
}

export function isAgeLimited(text) { return !!detectAgeLimit(text); }