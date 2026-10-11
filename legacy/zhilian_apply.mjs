#!/usr/bin/env node
// 智联 第二轮(高薪排序)：按索引点卡片 -> 读面板标题 -> 上限>=3万才投 -> 已投跳过
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = 'zl_round2b_log.txt';
const log = (s) => { const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };
import fs from 'node:fs';

function parseWan(s) {
  let m = s.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)万/);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  m = s.match(/(\d+)-(\d+)元/);
  if (m) return { min: parseInt(m[1]) / 10000, max: parseInt(m[2]) / 10000 };
  return { min: 0, max: 0 };
}

async function listTargets() { const r = await fetch('http://127.0.0.1:9222/json/list'); return await r.json(); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } }; }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}
async function connect(id) {
  const ts = await listTargets();
  const pages = ts.filter((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
  // 优先显式传入的完整 tabId（并行场景必须传，否则会 fallback 到错误标签页）
  const t = (id && pages.find((p) => p.id === id))
    || pages.find((p) => p.url.includes('zhaopin.com'))
    || pages[0];
  if (!t) throw new Error('no zhaopin tab');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  return new CDP(ws);
}
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result ? r.result.value : null;
}
async function moveMouse(cdp, x, y, steps = 7) {
  const sx = Math.max(0, x - (30 + Math.random() * 120)); const sy = Math.max(0, y - (20 + Math.random() * 90));
  for (let i = 1; i <= steps; i++) { const t = i / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(sx + (x - sx) * t + (Math.random() - 0.5) * 3), y: Math.round(sy + (y - sy) * t + (Math.random() - 0.5) * 3) });
    await sleep(9 + Math.random() * 18); }
}
async function clickAt(cdp, x, y) {
  await moveMouse(cdp, x, y);
  await sleep(45 + Math.random() * 60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30 + Math.random() * 45);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const CARD_AT = `(i)=>{const c=[...document.querySelectorAll('.job-card')][i];if(!c)return null;c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}}`;
const PANEL = `(function(){
  const t=document.querySelector('.job-detail-summary__title-text');
  const s=document.querySelector('.job-detail-summary__title');
  return {title:t?(t.innerText||'').trim():'', sal:s?((s.innerText||'').trim().replace(t?(t.innerText||'').trim():'','').trim()):''};
})()`;
const FIND_APPLY = `(()=>{
  const stay=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页'&&x.getBoundingClientRect().width>10&&x.getBoundingClientRect().height>10);
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim();const r=e.getBoundingClientRect();
    return r.width>80&&r.height>25&&r.width<300&&/^(立即投递|已投递|投递简历|已申请|继续沟通)$/.test(t);
  });
  if(stay)return {state:'stay',t:'留在此页'};
  if(!els.length)return null;
  const done=els.find(e=>/已投递|已申请|继续沟通/.test(e.textContent));
  if(done)return {state:'done',t:done.textContent.trim()};
  const b=els[0];const r=b.getBoundingClientRect();
  return {state:'ready',t:b.textContent.trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`;

async function main() {
  const cdp = await connect(process.argv[2]);
  const total = await evalJs(cdp, `document.querySelectorAll('.job-card').length`);
  log(`当前列表 ${total} 卡（高薪排序）`);
  let ok = 0, skip = 0, fail = 0, low = 0;

  for (let i = 0; i < total; i++) {
    try {
      const at = await evalJs(cdp, `(${CARD_AT})(${i})`);
      if (!at) { log(`#${i} 卡片不存在`); continue; }
      await sleep(600 + Math.random() * 500);
      await clickAt(cdp, at.x, at.y);
      await sleep(2200 + Math.random() * 1000);
      const p = await evalJs(cdp, PANEL);
      const { min, max } = parseWan(p.sal || '');
      if (max < 3) { log(`#${i} ${p.sal} ${p.title} -> 低于3万，跳过`); low++; continue; }

      let ap = await evalJs(cdp, FIND_APPLY);
      if (!ap) { await sleep(2000); ap = await evalJs(cdp, FIND_APPLY); }
      if (!ap) { log(`#${i} ${p.sal} ${p.title} -> 未找到投递按钮`); fail++; continue; }
      // 先关掉遗留的"留在此页"弹窗再判断
      if (ap.state === 'stay') {
        await evalJs(cdp, `(()=>{const b=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页');b&&b.click();return 1})()`);
        await sleep(1500);
        ap = await evalJs(cdp, FIND_APPLY);
        if (!ap) { log(`#${i} ${p.sal} ${p.title} -> 关弹窗后未找到按钮`); fail++; continue; }
      }
      if (ap.state === 'done') { log(`#${i} ${p.sal} ${p.title} -> 已投递，跳过`); skip++; continue; }
      if (ap.state === 'stay') { log(`#${i} 弹窗未关`); continue; }

      log(`#${i} ${p.sal} ${p.title} -> JS点击 ${ap.t}`);
      // 智联对 CDP 真实鼠标的投递点击静默忽略（2026-10-04 实测），改用 JS click
      const jc = await evalJs(cdp, `(function(){
        const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
          const t=(e.textContent||'').trim();const r=e.getBoundingClientRect();
          return r.width>80&&r.height>25&&r.width<300&&/^立即投递$/.test(t);
        });
        if(!els.length) return 'nf';
        els[0].click(); return 'ok';
      })()`);
      if (jc !== 'ok') { log(`  ! JS点击失败`); fail++; continue; }
      await sleep(2200 + Math.random() * 1200);
      const st = await evalJs(cdp, FIND_APPLY);
      if (st && st.state === 'stay') { await evalJs(cdp, `(()=>{const b=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页');b&&b.click();return 1})()`); await sleep(1200); }
      const ap2 = await evalJs(cdp, FIND_APPLY);
      if (ap2 && (ap2.state === 'done' || ap2.state === 'stay')) { log(`  ✓ 投递成功`); ok++; }
      else { log(`  ? 状态未确认（${ap2 ? ap2.t : 'null'}）`); fail++; }
    } catch (e) { log(`#${i} ERR ` + e.message.slice(0, 140)); fail++; }
    await sleep(6000 + Math.random() * 6000);
  }
  log(`\n===== 智联第二轮完成：成功 ${ok} / 已投跳过 ${skip} / 低薪 ${low} / 失败 ${fail} =====`);
}
main().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
