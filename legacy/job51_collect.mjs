// 51job 采集器：在"薪资优先"排序下逐页扫描，按下限(起薪)阈值筛岗位
import fs from 'node:fs';
import { connect, evalJs, sleep, currentId, SCAN_CARDS, parseSalary } from './jlib.mjs';

const SEARCH_ID = process.argv[2] || currentId();
const MAX_PAGE = Number(process.argv[3] || 20);
const THRESH = Number(process.argv[4] || 2.5); // 起薪(下限)阈值，单位：万/月

const { cdp } = await connect(SEARCH_ID);
const all = [];
const seen = new Set();

async function gotoPage(n) {
  const ok = await evalJs(cdp, `(function(){
    const li=[...document.querySelectorAll('.el-pager li.number')].find(x=>(x.innerText||'').trim()==='${n}');
    if(!li) return 'no-pager'; li.click(); return 'ok';
  })()`);
  await sleep(2800);
  return ok;
}

await evalJs(cdp, `(function(){const li=[...document.querySelectorAll('.el-pager li.number')].find(x=>(x.innerText||'').trim()==='1');if(li)li.click();return 1;})()`);
await sleep(2800);

for (let p = 1; p <= MAX_PAGE; p++) {
  if (p > 1) {
    const r = await gotoPage(p);
    if (r !== 'ok') { console.log(`page ${p}: no pager -> stop`); break; }
  }
  const cards = await evalJs(cdp, SCAN_CARDS);
  let hits = 0;
  for (const c of cards || []) {
    const { minW, maxW } = parseSalary(c.sal);
    if (minW >= THRESH) hits++;
    if (c.jobId && !seen.has(c.jobId)) {
      seen.add(c.jobId);
      all.push({ jobId: c.jobId, title: c.title, sal: c.sal, city: c.city, minW, maxW, cardBtns: c.btns });
    }
  }
  console.log(`page ${p}: cards=${cards?.length ?? 0}, 起薪>=${THRESH}万=${hits}`);
  if (hits === 0) { console.log(`page ${p}: none with 起薪>=${THRESH}万 -> stop`); break; }
}

const picked = all.filter((x) => x.minW >= THRESH);
fs.writeFileSync('j_all_scanned.json', JSON.stringify(all, null, 1));
fs.writeFileSync('j_apply_targets.json', JSON.stringify(picked, null, 1));
console.log(`\nscanned unique jobs = ${all.length}`);
console.log(`起薪>=${THRESH}万 = ${picked.length} 个`);
console.log('\n--- 待投递清单 ---');
for (const j of picked) console.log(`${j.sal} | ${j.title} | ${j.city} | ${j.jobId}`);
cdp.ws.close();
