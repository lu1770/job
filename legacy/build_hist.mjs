// 汇总 job/ 下所有历史 JSON 中的 BOSS 岗位 href，构建去重集合
import fs from 'node:fs';
import path from 'node:path';

const dir = '.';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const hrefSet = new Set();
const nameCoSet = new Set();
const perFile = {};

for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  let n = 0;
  for (const j of arr) {
    if (!j || typeof j !== 'object') continue;
    const href = (j.href || j.url || '').toString();
    if (!/zhipin\.com\/job_detail/.test(href)) continue;
    const abs = href.startsWith('http') ? href : 'https://www.zhipin.com' + href;
    const id = (abs.match(/job_detail\/([^.]+)\.html/) || [])[1];
    if (id) { hrefSet.add(id); n++; }
    if (j.name && j.company) nameCoSet.add(j.name.trim() + '||' + j.company.trim());
  }
  if (n) perFile[f] = n;
}

fs.writeFileSync('_hist_boss.json', JSON.stringify({ ids: [...hrefSet], nameCo: [...nameCoSet] }, null, 1));
console.log('历史 BOSS jobId 数:', hrefSet.size);
console.log('历史 标题+公司 数:', nameCoSet.size);
console.log(JSON.stringify(perFile, null, 1));
