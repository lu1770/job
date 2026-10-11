// 猎聘 采集：多关键词搜索（苏州 dq=060080）→ 扫 .jobCardPcContainer → 解析薪资 → 过滤城市
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';

const TAB_ID = process.argv[2];
const KEYS = (process.argv[3] || '.NET,C#,上位机,WPF,运动控制,工业软件,MES').split(',');
const OUT = process.argv[4] || 'lp_scan_raw.json';
const DQ = '060080'; // 苏州

const { cdp } = await connect(TAB_ID);

const SCAN = `(function(){
  const cards=[...document.querySelectorAll('.jobCardPcContainer')];
  return JSON.stringify(cards.map(c=>{
    const txt=(c.innerText||'').replace(/\\n+/g,' | ');
    const a=c.querySelector('a[href]');
    const href=a?a.getAttribute('href'):'';
    // 标题 = 【 之前的部分
    let title=(txt.split('【')[0]||'').trim();
    // 城市 = 第一个【】内
    const cityM=txt.match(/【([^】]*)】/);
    // 薪资行
    const salM=txt.match(/(\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?\\s*[kKwW])|(\\d+(?:\\.\\d+)?\\s*[kKwW])/);
    // 公司：取 城市/薪资/经验/学历 之后的段
    const parts=txt.split(' | ').map(s=>s.trim()).filter(Boolean);
    return { title, city: cityM?cityM[1]:'', sal: salM?salM[0].replace(/\\s+/g,''):'', href, txt: txt.slice(0,260), parts: parts.slice(0,9) };
  }));
})()`;

const PROBE = `(function(){const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');return JSON.stringify({url:location.href,slider:/滑动验证|拖动滑块|请完成安全验证/.test(t),loginWall:/登录\\/注册|立即登录/.test(t)&&!/你好/.test(t),n:document.querySelectorAll('.jobCardPcContainer').length});})()`;

function parseK(sal) {
  if (!sal) return { min: 0, max: 0 };
  const s = sal.toLowerCase();
  let m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[wW万]/);
  if (m) return { min: parseFloat(m[1]) * 10, max: parseFloat(m[2]) * 10 };
  m = s.match(/(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[1]) };
  m = s.match(/(\d+(?:\.\d+)?)\s*[wW万]/);
  if (m) return { min: parseFloat(m[1]) * 10, max: parseFloat(m[1]) * 10 };
  return { min: 0, max: 0 };
}

const all = [];
const seen = new Set();
let aborted = false;

for (const kw of KEYS) {
  if (aborted) break;
  const url = `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(kw)}&dq=${DQ}`;
  console.log(`\n=== 关键词: ${kw} ===`);
  await navAndWait(cdp, url, 3200);
  let p = JSON.parse((await evalJs(cdp, PROBE)) || '{}');
  if (p.slider) { console.log('!! 触发滑动验证 -> 停止'); aborted = true; break; }
  if (p.loginWall) { console.log('!! 未登录 -> 停止'); aborted = true; break; }

  // 滚动懒加载
  let last = 0, stable = 0;
  for (let s = 0; s < 15; s++) {
    const n = await evalJs(cdp, `document.querySelectorAll('.jobCardPcContainer').length`);
    if (n === last) { stable++; if (stable >= 3) break; } else { stable = 0; }
    last = n;
    await evalJs(cdp, `window.scrollTo(0, document.body.scrollHeight); 'ok'`);
    await sleep(2400);
  }
  const raw = await evalJs(cdp, SCAN);
  const arr = JSON.parse(raw || '[]');
  let kept = 0;
  for (const j of arr) {
    if (!j.href) continue;
    const id = (j.href.match(/liepin\.com\/(?:a|job)\/(\d+)\.shtml/) || [])[1] || j.href;
    if (seen.has(id)) continue;
    seen.add(id);
    const city = j.city || '';
    // 只保留苏州（或城市字段为空但标题含苏州）
    if (city && !/苏州/.test(city)) continue;
    const { min, max } = parseK(j.sal);
    all.push({ ...j, id, kw, minK: min, maxK: max, url: j.href });
    kept++;
  }
  console.log(`  ${kw}: 扫到 ${arr.length} 张，留存(苏州) ${kept} 张`);
  await sleep(2500);
}

fs.writeFileSync(OUT, JSON.stringify(all, null, 1));
const hit = all.filter((j) => j.maxK >= 25);
console.log(`\n采集总数 ${all.length}（去重+苏州）｜上限≥25K：${hit.length}`);
console.log(JSON.stringify(hit.map((j) => ({ n: j.title, s: j.sal, k: j.kw, c: (j.parts[5]||'') })), null, 1));
cdp.ws.close();
