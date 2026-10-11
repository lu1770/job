// BOSS 单会话读取测试：打开聊天页 → 按索引切会话 → 读消息
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const TAB = process.argv[2];
const IDX = Number(process.argv[3] || 25);
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

const pos = JSON.parse((await ev(`(function(){
  const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
  const el=items[${IDX}]; if(!el) return 'null';
  let p=el.parentElement;
  while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
  if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
  const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height),txt:(w.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,120)});
})()`)) || 'null');
console.log('目标会话:', JSON.stringify(pos));
if (!pos) { cdp.ws.close(); process.exit(0); }
await clickAt(pos.x, pos.y);
await sleep(3500);

const dump = await ev(`(function(){
  const conv=document.querySelector('.chat-conversation');
  const nodes=[...document.querySelectorAll('li.message-item')];
  const msgs=nodes.map(li=>{
    const c=li.querySelector('.message-content');
    return {me:li.classList.contains('item-myself'), time:(li.querySelector('.item-time')||{innerText:''}).innerText.trim(), status:(li.querySelector('.message-status')||{innerText:''}).innerText.trim(), text:(c?c.innerText:li.innerText).trim().slice(0,400)};
  });
  return JSON.stringify({
    convText: conv?conv.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,300):'NO_CONV',
    msgCount: msgs.length,
    msgs: msgs.slice(-12),
    hasFriendMsg: msgs.some(m=>!m.me)
  }, null, 1);
})()`, 25000);
console.log(dump);
try { cdp.ws.close(); } catch {}
