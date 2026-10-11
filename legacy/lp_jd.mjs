// 猎聘 JD 核验：逐个打开详情页，抽取正文 → 判定技术栈相关性
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { detectAgeLimit } from './age.mjs';

const TAB_ID = process.argv[2];
const IN = process.argv[3] || 'lp_candidates.json';
const OUT = process.argv[4] || 'lp_jd.json';
const cands = JSON.parse(fs.readFileSync(IN, 'utf8'));

const { cdp } = await connect(TAB_ID);

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
}
const ev = (expr, ms = 15000) => withTimeout(evalJs(cdp, expr), ms, 'ev');

const EXTRACT = `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n');
  const title=(document.querySelector('h1')?document.querySelector('h1').innerText:'').trim();
  return JSON.stringify({
    href:location.href,
    title,
    slider:/滑动验证|拖动滑块|请完成安全验证/.test(t),
    body:t.slice(0,5000)
  });
})()`;

const results = [];
try {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (Array.isArray(prev)) results.push(...prev);
} catch {}
const doneHref = new Set(results.map((r) => r.href));
const todo = cands.filter((c) => !doneHref.has(c.href));
console.log(`已核验 ${results.length} 条，待核验 ${todo.length} 条`);
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
let i = 0;
for (const j of todo) {
  i++;
  const tag = `[${i}/${todo.length}] ${j.title} | ${j.sal}`;
  const rec = { ...j };
  try {
    await withTimeout(navAndWait(cdp, j.href, 900), 40000, 'nav');
    const raw = await ev(EXTRACT, 20000);
    const d = JSON.parse(raw || '{}');
    rec.jdTitle = d.title;
    rec.slider = !!d.slider;
    const body = d.body || '';
    const b = body.toLowerCase();
    rec.f = {
      csharp: /c#|\.net|asp\.net|winform|wpf/.test(b),
      wpf: /wpf/.test(b),
      upper: /上位机/.test(body),
      motion: /运动控制/.test(body),
      mes: /mes|eap/.test(b),
      plc: /plc/.test(b),
      cpp: /c\+\+/.test(body),
      java: /java/.test(b),
      algo: /算法工程师|算法开发|视觉|图像处理|slam/.test(body),
      embed: /嵌入式|固件|单片机|dsp|fpga/.test(b),
      hw: /硬件设计|pcb|电路设计|原理图/.test(b),
      sales: /销售|客户开发|商务拓展/.test(body),
      mgr: /部门管理|团队管理|人员管理/.test(body),
    };
    rec.excerpt = body.replace(/\s+/g, ' ').slice(0, 220);
    // 年龄限制检测（命中即屏蔽该条）
    const age = detectAgeLimit(body);
    if (age) { rec.ageLimit = age; }
    console.log(`${tag}\n   JD标题: ${rec.jdTitle}\n   栈: ${Object.entries(rec.f).filter(([, v]) => v).map(([k]) => k).join(',')}${age ? '  ⛔年龄限制:' + age.hit : ''}${d.slider ? '  ⚠️滑块' : ''}`);
  } catch (e) {
    rec.err = e.message;
    console.log(`${tag} -> ❌ ${e.message}`);
  }
  results.push(rec);
  save();
  if (i < todo.length) await sleep(3500 + Math.random() * 2500);
}
console.log(`\n核验完成 累计 ${results.length} 条 -> ${OUT}`);
cdp.ws.close();
