// 汇总 job/ 下所有 JSON 中的猎聘岗位 href/id，构建去重集合
import fs from 'node:fs';
import path from 'node:path';

const dir = '.';
// 只纳入「已核验 / 已投递 / 已定稿清单 / 已剔除」类文件；排除纯采集(scan)/候选(candidates)/年龄专项中间产物
const INCLUDE = /apply|round|reverify|targets|_jd|jd\d|dropped/;
const EXCLUDE = /scan|candidates|age_in|age_out|_hist|_proc|_diag|slider/;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && INCLUDE.test(f) && !EXCLUDE.test(f));
const idSet = new Set();
const titleSalSet = new Set();
const perFile = {};

function walk(o, cb) {
  if (!o) return;
  if (Array.isArray(o)) { o.forEach((x) => walk(x, cb)); return; }
  if (typeof o === 'object') { cb(o); Object.values(o).forEach((v) => walk(v, cb)); }
}

for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  let n = 0;
  walk(arr, (j) => {
    const href = (j.href || j.url || '').toString();
    if (!/liepin\.com/.test(href)) return;
    const id = (href.match(/liepin\.com\/(?:a|job)\/(\d+)\.shtml/) || [])[1];
    const full = (href.match(/liepin\.com\/([^?#]+\.shtml)/) || [])[1];
    if (id) { idSet.add(id); n++; }
    else if (full) { idSet.add(full); n++; }
    const t = (j.title || j.name || '').toString().trim();
    const s = (j.sal || '').toString().trim();
    if (t) titleSalSet.add(t + '||' + s);
  });
  if (n) perFile[f] = n;
}

fs.writeFileSync('_hist_lp.json', JSON.stringify({ ids: [...idSet], titleSal: [...titleSalSet] }, null, 1));
console.log('历史猎聘 id 数:', idSet.size);
console.log('历史 标题+薪资 数:', titleSalSet.size);
console.log(JSON.stringify(perFile, null, 1));
