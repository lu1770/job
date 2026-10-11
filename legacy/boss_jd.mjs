// BOSS JD 核验（只读）：逐个开详情页读正文 → 判定技术栈相关性；支持断点续跑
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { detectAgeLimit } from './age.mjs';

const TAB_ID = process.argv[2];
const IN = process.argv[3] || 'boss_jd_todo.json';
const OUT = process.argv[4] || 'boss_jd_today.json';
const cands = JSON.parse(fs.readFileSync(IN, 'utf8'));

const { cdp } = await connect(TAB_ID);

function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
}
const ev = (expr, ms = 15000) => withTimeout(evalJs(cdp, expr), ms, 'ev');

const EXTRACT = `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n');
  const h=document.querySelector('h1')||document.querySelector('.job-name');
  return JSON.stringify({
    href:location.href,
    title:h?h.innerText.trim():'',
    slider:/滑动验证|拖动滑块|请完成安全验证|点击按钮进行验证/.test(t),
    loginWall:location.href.includes('/web/user/'),
    btn:(function(){const e=[...document.querySelectorAll('a,button,span,div')].find(x=>/^(立即沟通|继续沟通)$/.test((x.innerText||'').trim())&&x.getBoundingClientRect().width>60);return e?e.innerText.trim():'';})(),
    body:t.slice(0,5000)
  });
})()`;

const results = [];
try { const prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (Array.isArray(prev)) results.push(...prev); } catch {}
const done = new Set(results.map((r) => r.href));
const todo = cands.filter((c) => !done.has(c.url || c.href));
console.log(`已核验 ${results.length} 条，待核验 ${todo.length} 条`);
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
let i = 0;
for (const j of todo) {
  i++;
  const href = j.url || j.href;
  const tag = `[${i}/${todo.length}] ${j.name} | ${j.sal}`;
  const rec = { ...j, href };
  try {
    await withTimeout(navAndWait(cdp, href, 900), 40000, 'nav');
    const d = JSON.parse((await ev(EXTRACT, 20000)) || '{}');
    rec.jdTitle = d.title;
    rec.slider = !!d.slider;
    rec.loginWall = !!d.loginWall;
    rec.btn = d.btn;
    const body = d.body || '';
    const b = body.toLowerCase();
    rec.f = {
      csharp: /c#|\.net|asp\.net|winform|wpf/.test(b),
      wpf: /wpf/.test(b),
      upper: /上位机/.test(body),
      motion: /运动控制/.test(body),
      mes: /mes|eap|secs|gems/.test(b),
      cpp: /c\+\+/.test(body),
      java: /java/.test(b),
      qt: /qt5|qtcreator|\bqt\b/.test(b),
      algo: /算法工程师|视觉|图像处理|slam/.test(body),
      embed: /嵌入式|固件|单片机|dsp|fpga|linux驱动/.test(b),
      hw: /硬件设计|pcb|电路设计|原理图|电气/.test(body),
      sales: /销售|客户开发|商务拓展|市场开拓/.test(body),
      plague: /外包|外派|驻场|人力外包|底薪\+提成|计件/.test(body),
    };
    rec.excerpt = body.replace(/\s+/g, ' ').slice(0, 220);
    // 年龄限制检测（命中即屏蔽该条）
    const age = detectAgeLimit(body);
    if (age) { rec.ageLimit = age; }
    console.log(`${tag} | 按钮:${rec.btn} | 栈: ${Object.entries(rec.f).filter(([, v]) => v).map(([k]) => k).join(',')}${age ? ' ⛔年龄限制:' + age.hit : ''}${d.slider ? ' ⚠️滑块' : ''}`);
    if (d.loginWall) { console.log('!! 未登录 -> 停止'); results.push(rec); save(); break; }
    if (d.slider) { console.log('!! 滑块 -> 停止'); results.push(rec); save(); break; }
  } catch (e) {
    rec.err = e.message;
    console.log(`${tag} -> ❌ ${e.message}`);
  }
  results.push(rec);
  save();
  if (i < todo.length) await sleep(5000 + Math.random() * 3000);
}
console.log(`\n核验累计 ${results.length} 条 -> ${OUT}`);
cdp.ws.close();
