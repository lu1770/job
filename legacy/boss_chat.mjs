// BOSS 消息扫描：打开聊天页 → 扫会话列表 → 真实鼠标逐个切会话 → 读最后消息 → 分类
import fs from 'node:fs';
import { enableVisibility } from './emu.mjs';
import { connect, evalJs, sleep } from './jlib.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'boss_chat_today.json';
const MAX = Number(process.argv[4] || 60);

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
await sleep(7000);

const SCAN = `(function(){
  const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
  return JSON.stringify(items.map((li,i)=>{
    const badge=li.querySelector('.notice-badge');
    const warp=li.querySelector('.friend-content-warp');
    const last=li.querySelector('.last-msg-text');
    const r=warp?warp.getBoundingClientRect():null;
    return {
      i,
      badge: badge?badge.innerText.trim():'',
      name: (li.querySelector('.friend-name,.name-text')||{innerText:''}).innerText.trim(),
      last: last?last.innerText.trim().slice(0,120):'',
      txt: (warp?warp.innerText:li.innerText).replace(/\\s*\\n\\s*/g,' | ').trim().slice(0,200),
      x: r?Math.round(r.x+r.width/2):0, y: r?Math.round(r.y+r.height/2):0
    };
  }));
})()`;

const list = JSON.parse((await ev(SCAN, 25000)) || '[]');
console.log(`会话数: ${list.length}｜带未读徽标: ${list.filter((x) => x.badge).length}`);

const READ = `(function(){
  const conv=document.querySelector('.chat-conversation');
  const placeholder=conv?/与您进行过沟通的 Boss 都会在左侧列表中显示/.test(conv.innerText):true;
  const msgs=[...document.querySelectorAll('li.message-item')].map(li=>({
    me: li.classList.contains('item-myself'),
    time:(li.querySelector('.item-time')||{innerText:''}).innerText.trim(),
    status:(li.querySelector('.message-status')||{innerText:''}).innerText.trim(),
    text:(li.querySelector('.message-content')||li).innerText.trim().slice(0,300)
  }));
  const dialogs=[...document.querySelectorAll('.item-dialog')].map(d=>{const r=d.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),text:d.innerText.trim().slice(0,120)};}).filter(d=>d.w>10);
  return JSON.stringify({placeholder, msgCount:msgs.length, msgs:msgs.slice(-8), dialogs, head: conv?conv.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,160):''});
})()`;

const convs = [];
const target = list.slice(0, MAX);
for (let k = 0; k < target.length; k++) {
  const it = target[k];
  try {
    // 滚到可视区
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
    if (!pos || pos.w < 20) { convs.push({ ...it, err: 'no_el' }); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2400);
    const r = JSON.parse((await ev(READ, 20000)) || '{}');
    convs.push({ ...it, head: r.head || '', msgCount: r.msgCount || 0, msgs: r.msgs || [], dialogs: r.dialogs || [] });
    const last = (r.msgs || [])[r.msgs.length - 1];
    console.log(`[${k + 1}/${target.length}] ${(it.txt || '').slice(0, 40)} | 末条: ${last ? (last.me ? '我: ' : '对方: ') + last.text.replace(/\n/g, ' ').slice(0, 60) : '无'}${r.dialogs && r.dialogs.length ? ' ⚠️弹窗' : ''}`);
  } catch (e) {
    convs.push({ ...it, err: e.message });
    console.log(`[${k + 1}] ERR ${e.message}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ listLen: list.length, list, convs }, null, 1));
  await sleep(600);
}
console.log(`\n扫描完成 ${convs.length} 会话 -> ${OUT}`);
cdp.ws.close();
