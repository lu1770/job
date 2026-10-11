// 只读复核：只看 BOSS 带未读徽标的会话，判断是否有"待回复的实质提问"（不发消息）
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'boss_unread_check.json';
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
             last: last?last.innerText.trim().slice(0,140):'' };
  }));
})()`;
const list = JSON.parse((await ev(SCAN, 25000)) || '[]');
const targets = list.filter((x) => x.badge);
console.log('会话总数', list.length, '｜带未读', targets.length, '→', targets.map((t) => `${t.name}(${t.badge})`).join(' / '));

const READ = `(function(){
  const conv=document.querySelector('.chat-conversation');
  const placeholder=conv?/与您进行过沟通的 Boss 都会在左侧列表中显示/.test(conv.innerText):true;
  const msgs=[...document.querySelectorAll('li.message-item')].map(li=>({
    me: li.classList.contains('item-myself'),
    time:(li.querySelector('.item-time')||{innerText:''}).innerText.trim(),
    text:(li.querySelector('.message-content')||li).innerText.trim().slice(0,300)
  }));
  return JSON.stringify({placeholder, msgs:msgs.slice(-6), head: conv?conv.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,140):''});
})()`;

const out = [];
for (let k = 0; k < targets.length; k++) {
  const it = targets[k];
  try {
    await ev(`(function(){
      const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
      const el=items[${it.i}]; if(!el) return 'no';
      let p=el.parentElement;
      while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
      return 'ok';
    })()`);
    await sleep(450);
    const pos = JSON.parse((await ev(`(function(){
      const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
      const el=items[${it.i}]; if(!el) return 'null';
      const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    })()`)) || 'null');
    if (!pos || pos.w < 20) { out.push({ ...it, err: 'no_el' }); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2300);
    const r = JSON.parse((await ev(READ, 20000)) || '{}');
    out.push({ ...it, placeholder: r.placeholder, head: r.head, msgs: r.msgs || [] });
    const last = (r.msgs || [])[r.msgs.length - 1];
    console.log(`[${k + 1}/${targets.length}] ${it.name}｜末条: ${last ? (last.me ? '我: ' : '对方: ') + last.text.replace(/\n/g, ' ').slice(0, 70) : '无'}`);
  } catch (e) {
    out.push({ ...it, err: e.message });
    console.log(`[${k + 1}] ERR ${e.message}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await sleep(700);
}
console.log('done ->', OUT);
cdp.ws.close();
