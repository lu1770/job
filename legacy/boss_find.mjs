// 按名称关键词定位 BOSS 会话并读取全文（真实鼠标切会话）
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const KEYS = process.argv.slice(3);
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

const FIND = (kw) => `(function(){
  const items=[...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'));
  for(let i=0;i<items.length;i++){
    const el=items[i]; const t=(el.innerText||'');
    if(t.indexOf(${JSON.stringify(kw)})<0) continue;
    let p=el.parentElement;
    while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
    if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-120); }
    const w=el.querySelector('.friend-content-warp'); const r=w.getBoundingClientRect();
    return JSON.stringify({i,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),txt:t.replace(/\\s*\\n\\s*/g,' | ').slice(0,160)});
  }
  return 'null';
})()`;

const READ = `(function(){
  const nodes=[...document.querySelectorAll('li.message-item')];
  const msgs=nodes.map(li=>({me:li.classList.contains('item-myself'), time:(li.querySelector('.item-time')||{innerText:''}).innerText.trim(), text:((li.querySelector('.message-content')||li).innerText||'').trim().slice(0,300)}));
  const dialogs=[...document.querySelectorAll('.item-dialog')].map(d=>{const r=d.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),text:d.innerText.replace(/\\s+/g,' ').trim().slice(0,160)};}).filter(d=>d.w>10);
  const input=document.querySelector('#chat-input');
  const head=document.querySelector('.chat-conversation');
  return JSON.stringify({msgs:msgs.slice(-10), dialogs, inputText:input?input.innerText.trim():'NO_INPUT', head:head?head.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,120):''});
})()`;

for (const kw of KEYS) {
  const pos = JSON.parse((await ev(FIND(kw))) || 'null');
  console.log(`\n===== 关键词「${kw}」`, pos ? `→ ${pos.txt}` : '→ 未找到');
  if (!pos) continue;
  await clickAt(pos.x, pos.y);
  await sleep(3000);
  const r = JSON.parse((await ev(READ, 22000)) || '{}');
  console.log('   head:', r.head);
  (r.msgs || []).forEach((m) => console.log('   ', m.me ? '我: ' : '对: ', String(m.text).replace(/\n+/g, ' / ').slice(0, 220)));
  if (r.dialogs && r.dialogs.length) console.log('   ⚠️弹窗:', JSON.stringify(r.dialogs));
  if (r.inputText) console.log('   输入框残留:', r.inputText.slice(0, 60));
  await sleep(800);
}
cdp.ws.close();
