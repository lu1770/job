// 只读复核 v3：v1 的点击方式 + 仅滚动"含 li.message-item 的祖先容器"到最底，再读全部消息
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'boss_unread_v3.json';
const { cdp } = await connect(TAB);
await enableVisibility(cdp);
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
const ev = (e, ms = 15000) => withTimeout(evalJs(cdp, e), ms);
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 50, y: y - 30 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

await ev(`location.href='https://www.zhipin.com/web/geek/chat';'sent'`, 12000);
await sleep(6500);

const SCAN = `(function(){
  const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
  return JSON.stringify(items.map((li,i)=>{
    const badge=li.querySelector('.notice-badge');
    const last=li.querySelector('.last-msg-text');
    return { i, badge: badge?badge.innerText.trim():'', name:(li.querySelector('.friend-name,.name-text')||{innerText:''}).innerText.trim(),
             preview: last?last.innerText.trim().slice(0,160):'' };
  }));
})()`;
const list = JSON.parse((await ev(SCAN, 25000)) || '[]');
const targets = list.filter((x) => x.badge);

const CHAT_BOTTOM = `(function(){
  const li=document.querySelector('li.message-item'); if(!li) return 'no-item';
  let p=li.parentElement;
  while(p && p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
  if(p && p!==document.body){ p.scrollTop=p.scrollHeight; return 'ok:'+(p.scrollHeight-p.clientHeight); }
  return 'no-scroller';
})()`;

const READ = `(function(){
  const conv=document.querySelector('.chat-conversation');
  const placeholder=conv?/与您进行过沟通的 Boss 都会在左侧列表中显示/.test(conv.innerText):true;
  const msgs=[...document.querySelectorAll('li.message-item')].map(li=>({
    me: li.classList.contains('item-myself'),
    time:(li.querySelector('.item-time')||{innerText:''}).innerText.trim(),
    text:(li.querySelector('.message-content')||li).innerText.trim().slice(0,300)
  }));
  return JSON.stringify({placeholder, n:msgs.length, msgs:msgs.slice(-10), head: conv?conv.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,120):''});
})()`;

const out = [];
for (let k = 0; k < targets.length; k++) {
  const it = targets[k];
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ev(`(function(){
        const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
        const el=items[${it.i}]; if(!el) return 'no';
        let p=el.parentElement;
        while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
        if(p&&p!==document.body){ const rr=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (rr.top-cr.top-120); }
        return 'ok';
      })()`);
      await sleep(500);
      const pos = JSON.parse((await ev(`(function(){
        const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
        const el=items[${it.i}]; if(!el) return 'null';
        const w=el.querySelector('.friend-content-warp'); const rr=w.getBoundingClientRect();
        return JSON.stringify({x:Math.round(rr.x+rr.width/2),y:Math.round(rr.y+rr.height/2),w:Math.round(rr.width)});
      })()`)) || 'null');
      if (!pos || pos.w < 20) { await sleep(600); continue; }
      await clickAt(pos.x, pos.y);
      await sleep(2600);
      for (let s = 0; s < 3; s++) { await ev(CHAT_BOTTOM); await sleep(500); }
      const got = JSON.parse((await ev(READ, 20000)) || '{}');
      if (got && !got.placeholder && (got.msgs || []).length) { r = got; break; }
      await sleep(800);
    } catch (e) { r = { err: e.message }; }
  }
  out.push({ ...it, ...(r || { err: 'open_failed' }) });
  const ms = (r && r.msgs) || [];
  const last = ms[ms.length - 1];
  console.log(`[${k + 1}/${targets.length}] ${it.name} | 预览: ${(it.preview || '').slice(0, 34)} | 末条: ${last ? (last.me ? '我: ' : '对方: ') + last.text.replace(/\n/g, ' ').slice(0, 80) : (r && r.err ? r.err : '无')}`);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await sleep(700);
}
console.log('done ->', OUT);
cdp.ws.close();
