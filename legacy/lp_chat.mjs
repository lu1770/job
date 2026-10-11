// 猎聘消息中心扫描：真实鼠标点右下角悬浮球 → 读抽屉会话列表 → 逐个打开读最后几条消息
import fs from 'node:fs';
import { enableVisibility } from './emu.mjs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'lp_chat.json';
const MAX_CONV = Number(process.argv[4] || 30);

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

// 1) 打开消息抽屉
await navAndWait(cdp, 'https://www.liepin.com/zhaopin/?key=.NET&dq=060080', 3000);
const ball = await ev(`(function(){
  const cands=[...document.querySelectorAll('.im-ui-basic-entry-title, [class*=entry-title], [class*=basic-entry]')];
  const e=cands.map(x=>{const r=x.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),t:(x.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40)};}).filter(o=>o.w>10);
  return JSON.stringify(e);
})()`);
console.log('悬浮球候选:', ball);
const balls = JSON.parse(ball || '[]');
// 优先点「有新消息」那个（最外层入口），否则取最宽的
const pick = balls.find((b) => /有新消息/.test(b.t)) || balls.slice().sort((a, b) => b.w - a.w)[0];
console.log('点击悬浮球:', JSON.stringify(pick));
if (pick) { await clickAt(pick.x, pick.y); await sleep(3500); }

const DETECT = `(function(){
  const sels=['.ant-im-drawer','[class*=ant-im-drawer]','[class*=im-drawer]','.im-ui-contact-list','[class*=contact-list-item]'];
  const found=[];
  for(const s of sels){const e=document.querySelector(s);if(e){const r=e.getBoundingClientRect();found.push(s+':'+Math.round(r.width)+'x'+Math.round(r.height));}}
  return JSON.stringify({found, bodyHas:(document.body.innerText||'').includes('我的沟通')});
})()`;
let opened = await ev(DETECT);
console.log('抽屉检测:', opened);
const op = JSON.parse(String(opened) || '{}');
if (!op.found || !op.found.length) {
  if (pick) { await clickAt(pick.x, pick.y); await sleep(4000); }
  console.log('重试后抽屉:', await ev(DETECT));
}

// 2) 读会话列表
const LIST = `(function(){
  const items=[...document.querySelectorAll('.im-ui-contact-list-item, [class*=contact-list-item]')];
  return JSON.stringify(items.map((it,i)=>{
    const txt=(it.innerText||'').replace(/\\n+/g,' | ').trim();
    const r=it.getBoundingClientRect();
    return {i, txt:txt.slice(0,240), unread:/\\[未读\\]|未读/.test(txt), y:Math.round(r.y+r.height/2), x:Math.round(r.x+r.width/2)};
  }));
})()`;
const list = JSON.parse((await ev(LIST, 20000)) || '[]');
console.log(`会话数: ${list.length}`);

// 3) 逐个打开读消息
const convs = [];
const target = list.slice(0, MAX_CONV);
for (let k = 0; k < target.length; k++) {
  const it = target[k];
  try {
    // 滚动到可视区
    await ev(`(function(){
      const items=[...document.querySelectorAll('.im-ui-contact-list-item, [class*=contact-list-item]')];
      const el=items[${it.i}]; if(!el) return 'no';
      let p=el.parentElement;
      while(p && p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=el.getBoundingClientRect(), cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
      return 'ok';
    })()`);
    await sleep(500);
    const pos = JSON.parse((await ev(`(function(){
      const items=[...document.querySelectorAll('.im-ui-contact-list-item, [class*=contact-list-item]')];
      const el=items[${it.i}]; if(!el) return 'null';
      const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    })()`)) || 'null');
    if (!pos) { convs.push({ i: it.i, txt: it.txt, err: 'no_el' }); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2200);
    const msgs = await ev(`(function(){
      const t=(document) ? null : null;
      const nodes=[...document.querySelectorAll('.im-ui-chat-list .text, .ant-im-chat-list .text, .text')];
      const out=[];
      for(const n of nodes){
        let mine=false,p=n;
        while(p){ if(/im-ui-txt\\s+send|\\bsend\\b/.test((p.className||'').toString())){mine=true;break;} p=p.parentElement; }
        const txt=(n.innerText||'').trim(); if(!txt||txt.length>400) continue;
        out.push({mine, txt});
      }
      const times=[...document.querySelectorAll('.im-ui-system-tip.format-time')].map(e=>(e.innerText||'').trim()).filter(Boolean);
      return JSON.stringify({msgs:out.slice(-10), times:[...new Set(times)].slice(-4)});
    })()`, 20000);
    const m = JSON.parse(msgs || '{}');
    convs.push({ i: it.i, txt: it.txt, unread: it.unread, msgs: m.msgs || [], times: m.times || [] });
    const last = (m.msgs || [])[m.msgs.length - 1];
    console.log(`[${k + 1}/${target.length}] ${it.txt.slice(0, 46)} | 末条: ${last ? (last.mine ? '我:' : '对方:') + last.txt.slice(0, 50) : '无'}`);
  } catch (e) {
    convs.push({ i: it.i, txt: it.txt, err: e.message });
    console.log(`[${k + 1}] ERR ${e.message}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ listLen: list.length, list, convs }, null, 1));
  await sleep(700);
}
console.log(`\n扫描完成 ${convs.length} 会话 -> ${OUT}`);
cdp.ws.close();
