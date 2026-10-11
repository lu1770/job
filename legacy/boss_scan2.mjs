// BOSS直聘 采集（加固版）：多关键词 → 滚动懒加载 → 扫 .job-card-box → PUA 解码薪资
// 改进：逐关键词容错、单次 eval 超时、增量落盘（避免挂起导致全部丢失）
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';

const TAB_ID = process.argv[2];
const KEYS = (process.argv[3] || '.NET|上位机').split('|');
const OUT = process.argv[4] || 'boss_scan_today.json';
const CITY = '101190400'; // 苏州

const { cdp } = await connect(TAB_ID);

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms)),
  ]);
}
const ev = (expr, ms = 15000) => withTimeout(evalJs(cdp, expr), ms, String(expr).slice(0, 40));

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

let all = [];
const seen = new Set();
try { all = JSON.parse(fs.readFileSync(OUT, 'utf8')); all.forEach((j) => seen.add(j.href)); } catch {}
let aborted = false;

const save = () => fs.writeFileSync(OUT, JSON.stringify(all, null, 1));

for (const kw of KEYS) {
  if (aborted) break;
  const url = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(kw)}&city=${CITY}`;
  console.log(`\n=== 关键词: ${kw} ===`);
  try {
    await withTimeout(navAndWait(cdp, url, 2200), 40000, 'nav:' + kw);
    let p = JSON.parse((await ev(PROBE)) || '{}');
    if (p.slider) { console.log('!! 触发滑块验证 -> 停止'); aborted = true; break; }
    if (p.loginWall) { console.log('!! 被重定向到登录页 -> 未登录'); aborted = true; break; }

    let last = 0, stable = 0;
    for (let s = 0; s < 25; s++) {
      const n = await ev(`document.querySelectorAll('.job-card-box').length`, 12000);
      if (n === last) { stable++; if (stable >= 3) break; } else { stable = 0; }
      last = n;
      await ev(`window.scrollTo(0, document.body.scrollHeight); 'ok'`, 12000);
      await sleep(2600);
      const chk = JSON.parse((await ev(PROBE, 12000)) || '{}');
      if (chk.slider) { console.log('!! 滚动中出现滑块 -> 停止'); aborted = true; break; }
    }
    const raw = await ev(SCAN, 20000);
    const arr = JSON.parse(raw || '[]');
    let added = 0;
    for (const j of arr) {
      if (!j.href) continue;
      if (seen.has(j.href)) continue;
      seen.add(j.href);
      const { min, max } = parseK(j.sal);
      all.push({ ...j, kw, minK: min, maxK: max, url: 'https://www.zhipin.com' + j.href });
      added++;
    }
    console.log(`  ${kw}: 扫到 ${arr.length} 张，新增 ${added}（累计 ${all.length}）`);
    save();
  } catch (e) {
    console.log(`  !! ${kw} 出错: ${e.message} -> 跳过该关键词`);
  }
  await sleep(2500);
}

save();
const hit = all.filter((j) => j.maxK >= 25);
console.log(`\n采集总数 ${all.length}（去重后）｜上限≥25K：${hit.length}`);
console.log(JSON.stringify(hit.map((j) => ({ n: j.name, s: j.sal, c: j.company, l: j.loc })), null, 1));
cdp.ws.close();
