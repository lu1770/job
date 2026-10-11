// BOSS直聘 第二轮补投：对薪资筛选(30-50K)出的岗位逐个开详情页，"立即沟通"则投，"继续沟通"跳过
import fs from 'node:fs';
import { connect, evalJs, sleep, currentId, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB_ID = process.argv[2] || currentId();
const TARGET_FILE = process.argv[3] || 'boss_round2.json';
const targets = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));

const { cdp } = await connect(TAB_ID);
await enableVisibility(cdp, VIS_WIDE);
const log = [];
let ok = 0, skip = 0, fail = 0;
const save = () => fs.writeFileSync('boss_apply_r4_log.json', JSON.stringify(log, null, 1));

// 单次 CDP 调用超时保护，避免标签页挂起导致整批卡死
function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
}
const evx = (expr, ms = 18000) => withTimeout(evalJs(cdp, expr), ms, 'ev');

async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 50, y: y - 30 });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(70 + Math.random() * 70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40 + Math.random() * 50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// 详情页沟通按钮（新版 op-btn-chat，兼容旧版 btn-startchat）
const FIND_BTN = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(立即沟通|继续沟通)$/.test(t)&&r.width>60&&r.height>20&&r.width<300;
  });
  if(!els.length) return null;
  const e=els[0]; const r=e.getBoundingClientRect();
  return {t:e.innerText.trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`;

// 弹窗"留在此页"
const FIND_STAY = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return t==='留在此页'&&r.width>40&&r.height>15;
  });
  if(!els.length) return null;
  const r=els[0].getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`;

for (let i = 0; i < targets.length; i++) {
  const j = targets[i];
  const tag = `[${i + 1}/${targets.length}] ${j.name} | ${j.sal}`;
  let rec = { ...j };
  try {
    await withTimeout(navAndWait(cdp, j.href, 1500), 40000, 'nav');
    let btn = await evx(FIND_BTN);
    if (!btn) { rec.result = 'no_btn'; console.log(`${tag} -> NO_BTN`); fail++; log.push(rec); save(); continue; }
    if (btn.t === '继续沟通') { rec.result = 'already'; console.log(`${tag} -> 已沟通(skip)`); skip++; log.push(rec); save(); continue; }

    // BOSS 详情页对 CDP 真实鼠标事件会静默忽略，JS click 反而有效（2026-10-04 实测）
    const jres = await evx(`(function(){
      const a=document.querySelector('a.btn-startchat')||document.querySelector('.btn-startchat-wrap');
      if(!a) return 'nf'; a.click(); return 'clicked';
    })()`);
    if (jres !== 'clicked') { rec.result = 'js_fail'; console.log(`${tag} -> JS点击失败`); fail++; log.push(rec); save(); continue; }
    await sleep(2200);
    // 处理"留在此页"弹窗
    for (let k = 0; k < 3; k++) {
      const stay = await evx(FIND_STAY);
      if (!stay) break;
      await clickAt(stay.x, stay.y);
      await sleep(1200);
    }
    await sleep(1200);
    const btn2 = await evx(FIND_BTN);
    if (btn2 && btn2.t === '继续沟通') { rec.result = 'ok'; console.log(`${tag} -> ✅ 已投递`); ok++; }
    else {
      // 按钮点击后可能直接跳到聊天页
      const url = await evx('location.href');
      if (/\/web\/geek\/chat|\/chat\//.test(url)) { rec.result = 'ok_chat'; console.log(`${tag} -> ✅ 已投递(进入聊天页)`); ok++; }
      else { rec.result = 'unknown'; rec.url = url; console.log(`${tag} -> ⚠️ 状态未知`); fail++; }
    }
  } catch (e) {
    rec.result = 'error'; rec.err = e.message; console.log(`${tag} -> ❌ ${e.message}`); fail++;
  }
  log.push(rec); save();
  if (i < targets.length - 1) await sleep(6000 + Math.random() * 6000);
}
console.log(`\n===== BOSS 第二轮: 成功 ${ok} / 跳过 ${skip} / 失败 ${fail} =====`);
cdp.ws.close();
