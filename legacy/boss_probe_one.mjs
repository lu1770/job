// 只读：定点打开某个会话（按列表项文字匹配），确认 head 与全部消息
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const KEY = process.argv[3];
const { cdp } = await connect(TAB);
await enableVisibility(cdp);
const ev = (e, ms = 15000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 50, y: y - 30 });
  await sleep(70); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(100); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

await ev(`location.href='https://www.zhipin.com/web/geek/chat';'sent'`, 12000);
await sleep(7000);

const pos = JSON.parse((await ev(`(function(){
  const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
  for(const el of items){
    if((el.innerText||'').indexOf(${JSON.stringify(KEY)})<0) continue;
    let p=el.parentElement;
    while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
    if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
    const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
    const badge=el.querySelector('.notice-badge');
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),badge:badge?badge.innerText.trim():'',txt:(el.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,200)});
  }
  return 'null';
})()`)) || 'null');
console.log('match:', JSON.stringify(pos));
if (!pos) { cdp.ws.close(); process.exit(0); }

for (let a = 0; a < 3; a++) {
  await clickAt(pos.x, pos.y);
  await sleep(2600);
  const head = await ev(`(function(){const c=document.querySelector('.chat-conversation');return c?c.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,90):'';})()`);
  if (String(head).indexOf(KEY) >= 0) break;
  console.log('retry open, head=', head);
}
await ev(`(function(){const li=document.querySelector('li.message-item');if(!li)return 'no';let p=li.parentElement;while(p&&p!==document.body){if(p.scrollHeight>p.clientHeight+5)break;p=p.parentElement;}if(p&&p!==document.body)p.scrollTop=p.scrollHeight;return 'ok';})()`);
await sleep(1500);
const dump = await ev(`(function(){
  const conv=document.querySelector('.chat-conversation');
  const msgs=[...document.querySelectorAll('li.message-item')].map(li=>({me:li.classList.contains('item-myself'),t:(li.querySelector('.message-content')||li).innerText.trim().slice(0,260)}));
  const dialogs=[...document.querySelectorAll('.item-dialog')].map(d=>{const r=d.getBoundingClientRect();return {w:Math.round(r.width),t:d.innerText.trim().slice(0,120)};}).filter(d=>d.w>10);
  return JSON.stringify({head:conv?conv.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,140):'',n:msgs.length,msgs:msgs.slice(-8),dialogs});
})()`);
console.log(dump);
fs.writeFileSync('boss_probe_' + KEY + '.json', dump);
cdp.ws.close();
