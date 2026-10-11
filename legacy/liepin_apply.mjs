// 猎聘 第二轮补投：详情页"聊一聊"→变"继续聊"=成功；已沟通自动跳过
import fs from 'node:fs';
import { connect, evalJs, sleep, currentId, navAndWait } from './jlib.mjs';

const TAB_ID = process.argv[2] || currentId();
const TARGET_FILE = process.argv[3] || 'lp_round2.json';
const targets = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));

const { cdp } = await connect(TAB_ID);
const log = [];
let ok = 0, skip = 0, fail = 0;
const save = () => fs.writeFileSync('lp_round2_log.json', JSON.stringify(log, null, 1));

// 单次 CDP 调用超时保护
function withTimeout(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
}
const evx = (expr, ms = 18000) => withTimeout(evalJs(cdp, expr), ms, 'ev');

async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y: y - 25 });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(70 + Math.random() * 70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40 + Math.random() * 50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// 详情页按钮状态：done=继续聊/已沟通/已投递；ready=聊一聊（返回坐标）
const FIND = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(聊一聊|继续聊|已沟通|已投递|立即沟通)$/.test(t)&&r.width>40&&r.height>18&&r.width<260;
  });
  if(!els.length) return null;
  const done=els.find(e=>/继续聊|已沟通|已投递/.test(e.innerText));
  if(done) return {state:'done',t:done.innerText.trim()};
  const b=els[0]; const r=b.getBoundingClientRect();
  return {state:'ready',t:b.innerText.trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
})()`;

for (let i = 0; i < targets.length; i++) {
  const j = targets[i];
  const tag = `[${i + 1}/${targets.length}] ${j.title} | ${j.sal}`;
  let rec = { ...j };
  try {
    await withTimeout(navAndWait(cdp, j.href, 1500), 40000, 'nav');
    const st = await evx(FIND);
    if (!st) { rec.result = 'no_btn'; console.log(`${tag} -> NO_BTN`); fail++; log.push(rec); save(); continue; }
    if (st.state === 'done') { rec.result = 'already'; console.log(`${tag} -> 已沟通(skip)`); skip++; log.push(rec); save(); continue; }

    // 猎聘对 CDP 真实鼠标事件会静默忽略，JS click 有效（2026-10-04 实测，同 BOSS）
    const jc = await evx(`(function(){
      const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
        const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
        return t==='聊一聊'&&r.width>40&&r.height>18&&r.width<260;
      });
      if(!els.length) return 'nf';
      els[0].click(); return 'ok';
    })()`);
    if (jc !== 'ok') { rec.result = 'js_fail'; console.log(`${tag} -> JS点击失败`); fail++; log.push(rec); save(); continue; }
    await sleep(2500);
    const st2 = await evx(FIND);
    const url = await evx('location.href');
    if (st2 && st2.state === 'done') { rec.result = 'ok'; console.log(`${tag} -> ✅ 已投递`); ok++; }
    else if (/im\.liepin|\/chat/.test(url)) { rec.result = 'ok_chat'; console.log(`${tag} -> ✅ 已投递(IM页)`); ok++; }
    else { rec.result = 'unknown'; rec.url = url; console.log(`${tag} -> ⚠️ 状态未知`); fail++; }
  } catch (e) {
    rec.result = 'error'; rec.err = e.message; console.log(`${tag} -> ❌ ${e.message}`); fail++;
  }
  log.push(rec); save();
  if (i < targets.length - 1) await sleep(6000 + Math.random() * 6000);
}
console.log(`\n===== 猎聘 第二轮: 成功 ${ok} / 跳过 ${skip} / 失败 ${fail} =====`);
cdp.ws.close();
