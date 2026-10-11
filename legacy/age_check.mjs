// 通用「职位描述年龄限制」核验器：逐岗开详情页 → 读全文 → age.mjs 判定
// 用法：node age_check.mjs <tabId> <in.json> <out.json> [maxGapMs]
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
import { detectAgeLimit } from './age.mjs';

const TAB = process.argv[2];
const IN = process.argv[3];
const OUT = process.argv[4];
const MAXGAP = Number(process.argv[5] || 4000);
const list = JSON.parse(fs.readFileSync(IN, 'utf8'));

const { cdp } = await connect(TAB);
await enableVisibility(cdp, { width: 1600, height: 1000 });

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
}
const ev = (expr, ms = 15000) => withTimeout(evalJs(cdp, expr), ms, 'ev');

const EXTRACT = `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n');
  return JSON.stringify({
    href:location.href,
    title:(document.querySelector('h1')?document.querySelector('h1').innerText:'').trim(),
    slider:/滑动验证|拖动滑块|请完成安全验证|访问验证|请按住滑块/.test(t),
    loginWall:/\\/login|passport|请登录|登录后查看/.test(location.href+t.slice(0,300)),
    body:t.slice(0,9000)
  });
})()`;

const results = [];
try { const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (Array.isArray(prev)) results.push(...prev); } catch {}
const done = new Set(results.map((r) => (r.url || '').split('?')[0]));
const todo = list.filter((c) => !done.has((c.url || '').split('?')[0]));
console.log(`已核验 ${results.length} 条，待核验 ${todo.length} 条`);
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));

let i = 0, ageHits = 0;
for (const j of todo) {
  i++;
  const tag = `[${i}/${todo.length}] ${j.title} | ${j.sal}`;
  const rec = { ...j };
  try {
    await withTimeout(navAndWait(cdp, j.url, 800), 40000, 'nav');
    const d = JSON.parse((await ev(EXTRACT, 20000)) || '{}');
    rec.jdTitle = d.title;
    rec.slider = !!d.slider;
    rec.loginWall = !!d.loginWall;
    const body = d.body || '';
    rec.jdLen = body.length;
    rec.hasJD = /职位描述|岗位职责|工作职责|任职要求|任职资格|岗位要求/.test(body);
    rec.sample = body.replace(/\s+/g, ' ').slice(0, 260);
    const age = detectAgeLimit(body);
    rec.age = age;
    if (age) {
      ageHits++;
      console.log(`${tag}\n   ⛔ 年龄限制: 「${age.hit}」 (${age.kind}) …${age.ctx}`);
    } else {
      console.log(`${tag} -> ok (len=${rec.jdLen})${d.slider ? ' ⚠️滑块' : ''}`);
    }
    if (d.loginWall) { console.log('!! 未登录 -> 停止'); results.push(rec); save(); break; }
    if (d.slider) { console.log('!! 滑块 -> 停止'); results.push(rec); save(); break; }
  } catch (e) {
    rec.err = e.message;
    console.log(`${tag} -> ❌ ${e.message}`);
  }
  results.push(rec);
  save();
  if (i < todo.length) await sleep(2800 + Math.random() * MAXGAP);
}
console.log(`\n核验累计 ${results.length} 条，年龄限制命中 ${ageHits} 条 -> ${OUT}`);
cdp.ws.close();
