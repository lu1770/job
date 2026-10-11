// 51job 苏州采集：多关键词 × 薪资优先排序，逐页扫到无 ≥2.5万 命中即停
// Usage: node j51_scan.mjs <tabId> "<kw1,kw2>" <maxPages> <thresholdWan> <outAll.json> <outTargets.json>
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const KWS = (process.argv[3] || '.Net').split(',').map((s) => s.trim()).filter(Boolean);
const MAXP = Number(process.argv[4] || 15);
const TH = Number(process.argv[5] || 2.5);   // 薪资上限门槛(万)
const CAP = Number(process.argv[8] || 3.0);  // 薪资下限上限(万)：区间须与 [TH,CAP] 有交集
const OUT_ALL = process.argv[6] || 'j51_all.json';
const OUT_T = process.argv[7] || 'j51_targets.json';

function parseSal(s) {
  const r = { min: 0, max: 0 };
  if (!s) return r;
  let m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万\s*\/\s*年/);
  if (m) { r.min = (parseFloat(m[1]) / 12) * 10000; r.max = (parseFloat(m[2]) / 12) * 10000; return r; }
  m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万/);
  if (m) { r.min = parseFloat(m[1]) * 10000; r.max = parseFloat(m[2]) * 10000; return r; }
  m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) { r.min = parseFloat(m[1]) * 1000; r.max = parseFloat(m[2]) * 1000; return r; }
  m = s.match(/(\d{4,})\s*-\s*(\d{4,})\s*元/);
  if (m) { r.min = parseFloat(m[1]); r.max = parseFloat(m[2]); return r; }
  m = s.match(/^(\d+(?:\.\d+)?)\s*万/);
  if (m) { r.min = r.max = parseFloat(m[1]) * 10000; }
  return r;
}

const SCAN = `(function(){
  const items=[...document.querySelectorAll('.joblist-item')];
  return items.map(it=>{
    const sdEl=it.querySelector('[sensorsname]');
    let o={}; try{o=JSON.parse(sdEl.getAttribute('sensorsdata'));}catch(e){}
    const ce=it.querySelector('.cname');
    const comp=ce?(ce.innerText||'').trim().split('\\n')[0]:'';
    return {jobId:o.jobId||'', title:o.jobTitle||'', sal:o.jobSalary||'', city:o.jobArea||'', comp};
  });
})()`;

const { cdp } = await connect(TAB);
await enableVisibility(cdp);

const all = new Map();
const perKw = {};

for (const kw of KWS) {
  const url = `https://we.51job.com/pc/search?jobArea=070300&keyword=${encodeURIComponent(kw)}&searchType=2`;
  console.log(`\n=== KW ${kw} ===`);
  await navAndWait(cdp, url, 2500);

  // 点"薪资优先"（JS click，再校验排序是否生效）
  const sorted = await evalJs(cdp, `(function(){
    const s=[...document.querySelectorAll('span.ss')].find(x=>(x.innerText||'').trim()==='薪资优先');
    if(!s) return 'no-sort'; s.click(); return 'clicked';
  })()`);
  await sleep(3500);
  const first3 = await evalJs(cdp, `(function(){
    return [...document.querySelectorAll('.joblist-item')].slice(0,3).map(it=>{
      const el=it.querySelector('[sensorsname]');let o={};try{o=JSON.parse(el.getAttribute('sensorsdata'));}catch(e){}
      return o.jobSalary||'';
    });
  })()`);
  const active = await evalJs(cdp, `(function(){
    const s=[...document.querySelectorAll('span.ss')].find(x=>(x.innerText||'').trim()==='薪资优先');
    return s?(/on/.test(s.className)?'on':'off'):'missing';
  })()`);
  console.log(`排序按钮:${sorted} active=${active} 前3薪资=${JSON.stringify(first3)}`);

  let got = 0;
  for (let p = 1; p <= MAXP; p++) {
    if (p > 1) {
      const r = await evalJs(cdp, `(function(){
        const li=[...document.querySelectorAll('.el-pager li.number')].find(x=>(x.innerText||'').trim()==='${p}');
        if(!li) return 'no-pager'; li.click(); return 'ok';
      })()`);
      if (r !== 'ok') { console.log(`  p${p}: no pager -> stop`); break; }
      await sleep(2800);
    }
    const cards = await evalJs(cdp, SCAN) || [];
    let hits = 0;
    for (const c of cards) {
      const { min, max } = parseSal(c.sal);
      c.min = min; c.max = max; c.kw = kw;
      if (max >= TH * 10000) hits++;
      if (c.jobId && !all.has(c.jobId)) all.set(c.jobId, c);
      else if (c.jobId) { const e = all.get(c.jobId); if (max > e.max) { e.min = min; e.max = max; } }
    }
    got += cards.length;
    console.log(`  p${p}: cards=${cards.length} 上限>=${TH}万=${hits}`);
    if (hits === 0) { console.log(`  p${p}: 0 命中 -> stop`); break; }
  }
  perKw[kw] = got;
}

const arr = [...all.values()];
const wide = arr.filter((x) => x.max >= TH * 10000);
const targets = wide.filter((x) => x.min <= CAP * 10000);
fs.writeFileSync(OUT_ALL, JSON.stringify(arr, null, 1));
fs.writeFileSync(OUT_T, JSON.stringify(targets, null, 1));
console.log(`\n各关键词卡片数: ${JSON.stringify(perKw)}`);
console.log(`去重岗位 = ${arr.length}；上限>=${TH}万 = ${wide.length}；区间与[${TH},${CAP}]万有交集 = ${targets.length}`);
const over = wide.filter((x) => x.min > CAP * 10000);
if (over.length) { console.log(`（另有 ${over.length} 个上限>=${TH}万但起薪>${CAP}万，未纳入：${over.map((x) => x.title + '[' + x.sal + ']').join('；')}）`); }
console.log('\n--- 待投递（上限降序） ---');
targets.sort((a, b) => b.max - a.max).forEach((j) => console.log(`${j.sal.padEnd(14)} | ${j.title} | ${j.city} | ${j.jobId}`));
cdp.ws.close();
