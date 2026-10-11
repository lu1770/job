// BOSS直聘 采集：多关键词搜索 → 滚动懒加载 → 扫 .job-card-box → PUA 解码薪资
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';

const TAB_ID = process.argv[2];
const KEYS = (process.argv[3] || '.NET,上位机').split('|');
const OUT = process.argv[4] || 'boss_scan_raw.json';
const CITY = '101190400'; // 苏州

const { cdp } = await connect(TAB_ID);

const SCAN = `(function(){
  const dec=s=>[...s].map(ch=>{const c=ch.charCodeAt(0);return (c>=57393&&c<=57402)?String(c-57393):ch;}).join('');
  const cards=[...document.querySelectorAll('.job-card-box')];
  return JSON.stringify(cards.map(c=>{
    const a=c.querySelector('a.job-name');
    const salEl=c.querySelector('.job-salary');
    const co=c.querySelector('.boss-name');
    const loc=c.querySelector('.company-location');
    return {
      name:(a?(a.innerText||'').trim():''),
      href:(a?a.getAttribute('href'):''),
      sal:dec(salEl?salEl.textContent:''),
      company:(co?(co.innerText||'').trim():''),
      loc:(loc?(loc.innerText||'').trim():'')
    };
  }));
})()`;

const PROBE = `(function(){const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');return JSON.stringify({url:location.href,slider:/滑动验证|拖动滑块|点击按钮进行验证/.test(t),loginWall:location.href.includes('/web/user/'),n:document.querySelectorAll('.job-card-box').length});})()`;

function parseK(sal) {
  if (!sal) return { min: 0, max: 0 };
  const m = sal.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*K/i);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  const s = sal.match(/(\d+(?:\.\d+)?)\s*K/i);
  if (s) return { min: parseFloat(s[1]), max: parseFloat(s[1]) };
  return { min: 0, max: 0 };
}

const all = [];
const seen = new Set();
let aborted = false;

for (const kw of KEYS) {
  if (aborted) break;
  const url = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(kw)}&city=${CITY}`;
  console.log(`\n=== 关键词: ${kw} ===`);
  await navAndWait(cdp, url, 2500);
  let p = JSON.parse(await evalJs(cdp, PROBE) || '{}');
  if (p.slider) { console.log('!! 触发滑块验证 -> 停止'); aborted = true; break; }
  if (p.loginWall) { console.log('!! 被重定向到登录页 -> 未登录'); aborted = true; break; }

  let last = 0, stable = 0;
  for (let s = 0; s < 25; s++) {
    const n = await evalJs(cdp, `document.querySelectorAll('.job-card-box').length`);
    if (n === last) { stable++; if (stable >= 3) break; } else { stable = 0; }
    last = n;
    await evalJs(cdp, `window.scrollTo(0, document.body.scrollHeight); 'ok'`);
    await sleep(2600);
    const chk = JSON.parse(await evalJs(cdp, PROBE) || '{}');
    if (chk.slider) { console.log('!! 滚动中出现滑块 -> 停止'); aborted = true; break; }
  }
  const raw = await evalJs(cdp, SCAN);
  const arr = JSON.parse(raw || '[]');
  console.log(`  ${kw}: 扫到 ${arr.length} 张卡片`);
  for (const j of arr) {
    if (!j.href) continue;
    const key = j.href;
    if (seen.has(key)) continue;
    seen.add(key);
    const { min, max } = parseK(j.sal);
    all.push({ ...j, kw, minK: min, maxK: max, url: 'https://www.zhipin.com' + j.href });
  }
  await sleep(2500);
}

fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
const hit = all.filter((j) => j.maxK >= 25);
console.log(`\n采集总数 ${all.length}（去重后）｜上限≥25K：${hit.length}`);
console.log(JSON.stringify(hit.map((j) => ({ n: j.name, s: j.sal, c: j.company, l: j.loc })), null, 1));
cdp.ws.close();
