// 智联 苏州采集+投递：多关键词 × 高薪排序
// 卡片直读薪资/标题 -> 薪资区间与[TH,CAP]万有交集才算 -> 点卡片读面板 -> JS click 立即投递
// Usage: node zl_run.mjs <tabId> "<kw1,kw2>" <thWan> <capWan> <outLog.json>
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const KWS = (process.argv[3] || '.Net').split(',').map((s) => s.trim()).filter(Boolean);
const TH = Number(process.argv[4] || 2.5);   // 上限门槛(万)
const CAP = Number(process.argv[5] || 3.0);  // 起薪上限(万)
const LOW = Number(process.argv[6] || 2.0);  // 起薪下限(万)
const OUT = process.argv[7] || 'zl_run_log.json';

function parseSal(s) {
  const r = { min: 0, max: 0 };
  if (!s) return r;
  let m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万/);
  if (m) { r.min = parseFloat(m[1]) * 10000; r.max = parseFloat(m[2]) * 10000; return r; }
  m = s.match(/(\d{4,})\s*-\s*(\d{4,})\s*元/);
  if (m) { r.min = parseFloat(m[1]); r.max = parseFloat(m[2]); return r; }
  m = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (m) { r.min = parseFloat(m[1]) * 1000; r.max = parseFloat(m[2]) * 1000; return r; }
  m = s.match(/^(\d+(?:\.\d+)?)\s*万/);
  if (m) { r.min = r.max = parseFloat(m[1]) * 10000; }
  return r;
}

const HARD = /C\+\+|c\+\+|嵌入式|AUTOSAR|驾控|算法|机器视觉|视觉|Java|前端|硬件|电子|电气|结构|售前|销售|总监|采购|运维|测试|对日|FPGA|DSP|Labview|PLC|MCU|产品|工艺/i;
const POS = /\.?net|c#|c＃|上位机|wpf|winform|mes|工控|运动控制|工业软件|自动化软件|软件工程师|软件开发|软件架构|程序员/i;

const { cdp } = await connect(TAB);
await enableVisibility(cdp);

const log = [];
const seen = new Set();
let ok = 0, skip = 0, low = 0, fail = 0, irrelevant = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 1));

async function navHref(url, wait = 3500) {
  await evalJs(cdp, `location.href=${JSON.stringify(url)}`);
  for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await evalJs(cdp, 'document.readyState')) === 'complete') break; } catch {} }
  await sleep(wait);
}

const CARD_READ = `(function(){
  const cards=[...document.querySelectorAll('.job-card')];
  return cards.map(c=>{
    const tt=c.querySelector('.job-card__title-clamp [aria-label]');
    const title=tt?tt.getAttribute('aria-label'):((c.querySelector('.job-card__title-main')||{}).innerText||'').trim();
    const sal=((c.querySelector('.job-card__salary')||{}).innerText||'').trim();
    const comp=((c.querySelector('.job-card__company')||{}).innerText||'').trim().split('\\n')[0];
    // 卡片最后一行 = "城市 区 街道"，用于核验是否苏州岗位
    const lines=(c.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean);
    const loc=lines[lines.length-1]||'';
    return {title:title.trim(), sal, comp, loc};
  });
})()`;

const PANEL = `(function(){
  const t=document.querySelector('.job-detail-summary__title-text');
  const s=document.querySelector('.job-detail-summary__title');
  return {title:t?(t.innerText||'').trim():'', salTxt:s?(s.innerText||'').trim():''};
})()`;

const FIND_APPLY = `(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>10&&r.height>10;};
  const stay=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页'&&vis(x));
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim();const r=e.getBoundingClientRect();
    return r.width>80&&r.height>25&&r.width<300&&/^(立即投递|已投递|投递简历|已申请|继续沟通)$/.test(t)&&vis(e);
  });
  if(stay)return {state:'stay'};
  if(!els.length)return null;
  const done=els.find(e=>/已投递|已申请|继续沟通/.test(e.textContent));
  if(done)return {state:'done',t:done.textContent.trim()};
  const b=els[0];const r=b.getBoundingClientRect();
  return {state:'ready',t:b.textContent.trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`;

async function selectCard(i) {
  const at = await evalJs(cdp, `(function(){const c=document.querySelectorAll('.job-card')[${i}];if(!c)return null;c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (!at) return 'nf';
  await sleep(350);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 30, y: at.y - 20 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await sleep(70 + Math.random() * 70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50 + Math.random() * 50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2000 + Math.random() * 800);
  return 'ok';
}
async function closeStay() {
  await evalJs(cdp, `(()=>{const b=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页'&&x.getBoundingClientRect().width>10);b&&b.click();return 1})()`);
  await sleep(1200);
}

for (const kw of KWS) {
  console.log(`\n===== 智联 KW ${kw} =====`);
  await navHref(`https://www.zhaopin.com/jobs?jl=639&kw=${encodeURIComponent(kw)}`, 4000);
  // 点"高薪"（JS click，须避开导航同名项）
  const sc = await evalJs(cdp, `(()=>{const s=[...document.querySelectorAll('.jobs-list-sort-placeholder__item')].find(x=>(x.innerText||'').trim()==='高薪');if(!s)return 'nf';s.click();return 'ok';})()`);
  await sleep(3500);
  const cards = await evalJs(cdp, CARD_READ) || [];
  console.log(`排序:${sc} 卡片数:${cards.length} 前3薪资:${JSON.stringify(cards.slice(0, 3).map((c) => c.sal))}`);

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const { min, max } = parseSal(c.sal);
    const rec = { kw, idx: i, title: c.title, sal: c.sal, comp: c.comp, loc: c.loc, min, max };
    try {
      if (max < TH * 10000 || min < LOW * 10000 || min > CAP * 10000) { low++; continue; }
      const key = c.title + '|' + c.comp;
      if (HARD.test(c.title)) { irrelevant++; continue; }
      if (!POS.test(c.title)) { irrelevant++; continue; }

      await selectCard(i);
      const p = await evalJs(cdp, PANEL);
      rec.panelTitle = p.title;
      let ap = await evalJs(cdp, FIND_APPLY);
      if (!ap) { await sleep(1800); ap = await evalJs(cdp, FIND_APPLY); }
      if (ap && ap.state === 'stay') { await closeStay(); ap = await evalJs(cdp, FIND_APPLY); }
      if (!ap) { rec.result = 'no_button'; fail++; log.push(rec); save(); console.log(`  #${i} ${c.sal} ${c.title} -> 无投递按钮`); continue; }
      if (ap.state === 'done') { rec.result = 'already'; skip++; log.push(rec); save(); console.log(`  #${i} ${c.sal} ${c.title} -> 已投(skip)`); continue; }
      if (seen.has(key)) { rec.result = 'dupe'; log.push(rec); save(); continue; }
      seen.add(key);

      if (process.env.DRYRUN === '1') { rec.result = 'dry'; log.push(rec); save(); console.log(`  [dry] #${i} ${c.sal} ${c.title} | ${c.comp} | btn=${ap.t}`); continue; }

      const jc = await evalJs(cdp, `(function(){
        const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
          const t=(e.textContent||'').trim();const r=e.getBoundingClientRect();
          return r.width>80&&r.height>25&&r.width<300&&/^立即投递$/.test(t);
        });
        if(!els.length) return 'nf';
        els[0].click(); return 'ok';
      })()`);
      if (jc !== 'ok') { rec.result = 'click_fail'; fail++; log.push(rec); save(); console.log(`  #${i} ${c.sal} ${c.title} -> JS点击失败`); continue; }
      await sleep(2500 + Math.random() * 1200);
      let st = await evalJs(cdp, FIND_APPLY);
      if (st && st.state === 'stay') { await closeStay(); st = await evalJs(cdp, FIND_APPLY); }
      if (st && (st.state === 'done' || st.state === 'stay')) { rec.result = 'ok'; ok++; console.log(`  ✓ #${i} ${c.sal} ${c.title} | ${c.comp}`); }
      else { rec.result = 'unknown'; rec.after = st ? st.t : 'null'; fail++; console.log(`  ? #${i} ${c.sal} ${c.title} 状态未确认`); }
      log.push(rec); save();
    } catch (e) { rec.result = 'error'; rec.err = e.message; fail++; log.push(rec); save(); console.log(`  ✗ #${i} ${c.title} ${e.message}`); }
    await sleep(5500 + Math.random() * 5000);
  }
}

console.log(`\n===== 智联完成：成功 ${ok} / 已投跳过 ${skip} / 低薪或超区间 ${low} / 不相关 ${irrelevant} / 失败 ${fail} =====`);
cdp.ws.close();
