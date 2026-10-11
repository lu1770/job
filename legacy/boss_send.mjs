// BOSS 发送消息：按关键词定位会话 → 切会话 → 填 #chat-input → 真实鼠标点 .btn-send.btn-sure-v2
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const FILE = process.argv[3];              // [{key, text}]
const LOG = process.argv[4] || 'boss_send_log.json';
const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const { cdp } = await connect(TAB);
await enableVisibility(cdp);
const ev = (e, ms = 15000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 50, y: y - 30 });
  await sleep(70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(100);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

await ev(`location.href='https://www.zhipin.com/web/geek/chat';'sent'`, 12000);
await sleep(7000);

const log = [];
for (const it of items) {
  const rec = { key: it.key, text: it.text };
  try {
    const pos = JSON.parse((await ev(`(function(){
      const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
      for(let i=0;i<items.length;i++){
        const el=items[i]; if((el.innerText||'').indexOf(${JSON.stringify(it.key)})<0) continue;
        let p=el.parentElement;
        while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
        if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
        const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
        return JSON.stringify({i,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),txt:(el.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,120)});
      }
      return 'null';
    })()`)) || 'null');
    if (!pos) { rec.result = 'conv_not_found'; log.push(rec); console.log(it.key, '-> 会话未找到'); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2600);
    const before = await ev(`document.querySelectorAll('li.message-item').length`);
    // 填值
    const ins = await ev(`(function(){
      const el=document.querySelector('#chat-input'); if(!el) return 'no_input';
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(it.text)});
      return el.innerText.trim().length + '';
    })()`);
    rec.inserted = ins;
    if (ins === 'no_input' || Number(ins) < 5) { rec.result = 'insert_failed'; log.push(rec); console.log(it.key, '-> 输入失败', ins); continue; }
    await sleep(700);
    // 真实鼠标点发送
    const btn = JSON.parse((await ev(`(function(){
      const b=document.querySelector('.btn-send.btn-sure-v2'); if(!b) return 'null';
      const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    })()`)) || 'null');
    if (!btn) { rec.result = 'no_send_btn'; log.push(rec); console.log(it.key, '-> 无发送按钮'); continue; }
    await clickAt(btn.x, btn.y);
    await sleep(2600);
    const after = await ev(`document.querySelectorAll('li.message-item').length`);
    const inputLeft = await ev(`(function(){const el=document.querySelector('#chat-input');return el?el.innerText.trim().length:-1;})()`);
    rec.before = before; rec.after = after; rec.inputLeft = inputLeft;
    if (Number(inputLeft) === 0 && Number(after) > Number(before)) { rec.result = 'sent'; console.log(it.key, '-> ✅ 已发送 (消息数', before, '→', after, ')'); }
    else { rec.result = 'uncertain'; console.log(it.key, '-> ⚠️ 未确认 (输入框残留', inputLeft, ', 消息数', before, '→', after, ')'); }
  } catch (e) { rec.result = 'error'; rec.err = e.message; console.log(it.key, '-> ❌', e.message); }
  log.push(rec);
  fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
  await sleep(3500);
}
console.log(`\n发送完成: ${log.filter((x) => x.result === 'sent').length}/${items.length} 成功`);
cdp.ws.close();
