// 猎聘消息：从职位页点「继续聊/聊一聊」拉起 IM 抽屉 → 读会话列表 → 逐会话读消息
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'lp_chat.json';
const MAX = Number(process.argv[4] || 40);
const targets = JSON.parse(fs.readFileSync('lp_targets_today.json', 'utf8'));

const { cdp } = await connect(TAB);
await enableVisibility(cdp);
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
const ev = (e, ms = 15000) => withTimeout(evalJs(cdp, e), ms);

async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y: y - 25 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// 1) 用职位页拉起抽屉
let opened = false;
for (const t of targets.slice(0, 6)) {
  await navAndWait(cdp, t.href, 2500);
  const jc = await ev(`(function(){
    const cands=[...document.querySelectorAll('a,div')].filter(e=>/^(继续聊|聊一聊)$/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>60);
    if(!cands.length) return 'nf';
    const a=cands.find(e=>e.className&&e.className.toString().includes('btn-main'))||cands[0];
    a.click(); return 'ok';
  })()`);
  await sleep(4000);
  const det = JSON.parse((await ev(`(function(){
    const it=document.querySelectorAll('.im-ui-contact-list-item').length;
    const d=document.querySelector('.ant-im-drawer');
    return JSON.stringify({items:it, drawer:d?Math.round(d.getBoundingClientRect().width):0});
  })()`)) || '{}');
  console.log('尝试', t.title, '点击:', jc, '→', JSON.stringify(det));
  if (det.items > 0) { opened = true; break; }
}
if (!opened) {
  console.log('!! 未能拉起猎聘 IM 抽屉');
  fs.writeFileSync(OUT, JSON.stringify({ ok: false, reason: 'drawer_not_open' }, null, 1));
  cdp.ws.close();
  process.exit(0);
}

// 2) 读会话列表
const LIST = `(function(){
  const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
  return JSON.stringify(items.map((it,i)=>{
    const txt=(it.innerText||'').replace(/\\n+/g,' | ').trim();
    const r=it.getBoundingClientRect();
    return {i, txt:txt.slice(0,240), unread:/\\[未读\\]|未读/.test(txt), w:Math.round(r.width)};
  }));
})()`;
const list = JSON.parse((await ev(LIST, 20000)) || '[]');
console.log('会话数:', list.length);

// 3) 逐个读
const READ = `(function(){
  const nodes=[...document.querySelectorAll('.text')];
  const out=[];
  for(const n of nodes){
    let mine=false,p=n;
    while(p){ if(/im-ui-txt\\s+send|im-ui-txt-send/.test((p.className||'').toString())){mine=true;break;} p=p.parentElement; }
    const txt=(n.innerText||'').trim(); if(!txt||txt.length>300) continue;
    const isTime=/format-time/.test((n.className||'').toString());
    out.push({mine, isTime, txt});
  }
  const d=document.querySelector('.ant-im-drawer');
  const chatWin=document.querySelector('.im-ui-chat-list, [class*=chat-list]');
  return JSON.stringify({msgs:out.slice(-14), drawerLen:d?d.innerText.length:0, winLen:chatWin?chatWin.innerText.length:0});
})()`;

const convs = [];
for (let k = 0; k < Math.min(list.length, MAX); k++) {
  const it = list[k];
  try {
    await ev(`(function(){
      const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
      const el=items[${it.i}]; if(!el) return 'no';
      let p=el.parentElement;
      while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
      return 'ok';
    })()`);
    await sleep(450);
    const pos = JSON.parse((await ev(`(function(){
      const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
      const el=items[${it.i}]; if(!el) return 'null';
      const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    })()`)) || 'null');
    if (!pos || pos.w < 20) { convs.push({ ...it, err: 'no_el' }); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2300);
    const r = JSON.parse((await ev(READ, 20000)) || '{}');
    convs.push({ ...it, msgs: r.msgs || [] });
    const real = (r.msgs || []).filter((m) => !m.isTime);
    const last = real[real.length - 1];
    console.log(`[${k + 1}/${Math.min(list.length, MAX)}] ${(it.txt || '').slice(0, 46)} | 末条: ${last ? (last.mine ? '我: ' : '对方: ') + last.txt.replace(/\n/g, ' ').slice(0, 55) : '无'}`);
  } catch (e) {
    convs.push({ ...it, err: e.message });
    console.log(`[${k + 1}] ERR ${e.message}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ ok: true, listLen: list.length, list, convs }, null, 1));
  await sleep(700);
}
console.log(`\n扫描完成 ${convs.length} 会话 -> ${OUT}`);
cdp.ws.close();
