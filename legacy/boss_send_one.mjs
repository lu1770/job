// 发送单条 BOSS 消息（带"会话已正确打开"校验，避免发错人）
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const FILE = process.argv[3];
const LOG = process.argv[4] || 'boss_send_one_log.json';
const { key, verify, text } = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const { cdp } = await connect(TAB);
await enableVisibility(cdp);
const ev = (e, ms = 15000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 50, y: y - 30 });
  await sleep(70); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(100); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
const rec = { key, verify, text };

await ev(`location.href='https://www.zhipin.com/web/geek/chat';'sent'`, 12000);
await sleep(7000);

async function findPos() {
  return JSON.parse((await ev(`(function(){
    const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
    for(const el of items){
      if((el.innerText||'').indexOf(${JSON.stringify(key)})<0) continue;
      let p=el.parentElement;
      while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
      const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),txt:(el.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,160)});
    }
    return 'null';
  })()`)) || 'null');
}
const head = () => ev(`(function(){const c=document.querySelector('.chat-conversation');return c?c.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,120):'';})()`);

let opened = false;
for (let a = 0; a < 3 && !opened; a++) {
  const pos = await findPos();
  if (!pos) { rec.result = 'conv_not_found'; break; }
  rec.found = pos.txt;
  await clickAt(pos.x, pos.y);
  await sleep(2600);
  const h = await head();
  rec.head = h;
  if (String(h).indexOf(verify) >= 0) opened = true; else console.log('retry, head=', h);
}
if (!opened && !rec.result) rec.result = 'open_failed';

if (rec.result !== 'conv_not_found' && opened) {
  const before = await ev(`document.querySelectorAll('li.message-item').length`);
  const ins = await ev(`(function(){
    const el=document.querySelector('#chat-input'); if(!el) return 'no_input';
    el.focus(); document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return el.innerText.trim().length+'';
  })()`);
  rec.inserted = ins;
  if (ins === 'no_input' || Number(ins) < 5) rec.result = 'insert_failed';
  else {
    await sleep(700);
    const btn = JSON.parse((await ev(`(function(){
      const b=document.querySelector('.btn-send.btn-sure-v2'); if(!b) return 'null';
      const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
    })()`)) || 'null');
    if (!btn) rec.result = 'no_send_btn';
    else {
      await clickAt(btn.x, btn.y);
      await sleep(2800);
      const after = await ev(`document.querySelectorAll('li.message-item').length`);
      const left = await ev(`(function(){const el=document.querySelector('#chat-input');return el?el.innerText.trim().length:-1;})()`);
      rec.before = before; rec.after = after; rec.inputLeft = left;
      rec.result = (Number(left) === 0 && Number(after) > Number(before)) ? 'sent' : 'uncertain';
    }
  }
}
console.log(JSON.stringify(rec, null, 1));
fs.writeFileSync(LOG, JSON.stringify(rec, null, 1));
cdp.ws.close();
