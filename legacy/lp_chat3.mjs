// 猎聘消息 v3：修正读取范围——只读聊天窗容器内的消息，避开左侧岗位卡文本
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const OUT = process.argv[3] || 'lp_chat_r4_v2.json';
const MAX = Number(process.argv[4] || 30);
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

// 1) 拉起抽屉
let opened = false;
for (const t of targets.slice(0, 6)) {
  await navAndWait(cdp, t.href, 2200);
  await ev(`(function(){
    const c=[...document.querySelectorAll('a,div')].filter(e=>/^(继续聊|聊一聊)$/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>60);
    if(!c.length) return 'nf';
    const a=c.find(e=>e.className&&e.className.toString().includes('btn-main'))||c[0];
    a.click(); return 'ok';
  })()`);
  await sleep(4000);
  const n = await ev(`document.querySelectorAll('.im-ui-contact-list-item').length`);
  if (n > 0) { opened = true; break; }
}
if (!opened) { console.log('!! 抽屉未打开'); fs.writeFileSync(OUT, JSON.stringify({ ok: false }, null, 1)); cdp.ws.close(); process.exit(0); }

// 2) 列表
const LIST = `(function(){
  const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
  return JSON.stringify(items.map((it,i)=>({i, txt:(it.innerText||'').replace(/\\n+/g,' | ').trim().slice(0,240)})));
})()`;
const list = JSON.parse((await ev(LIST, 20000)) || '[]');
console.log('会话数:', list.length);

// 3) 聊天窗范围读取（排除左侧岗位卡）
const READ = `(function(){
  // 聊天窗 = 含输入框的那一列
  const ta=document.querySelector('textarea.ant-im-input');
  let win=null;
  if(ta){ let p=ta.parentElement; while(p&&p!==document.body){ if(p.querySelectorAll('.text').length>2){win=p;break;} p=p.parentElement; } }
  if(!win){ win=document.querySelector('.im-ui-chat-list')||document.querySelector('[class*=chat-list]'); }
  if(!win) return JSON.stringify({err:'no_win'});
  const nodes=[...win.querySelectorAll('.text')];
  const out=[];
  for(const n of nodes){
    let mine=false,p=n;
    while(p){ if(/im-ui-txt\\s+send|im-ui-txt-send/.test((p.className||'').toString())){mine=true;break;} p=p.parentElement; }
    const txt=(n.innerText||'').trim(); if(!txt||txt.length>400) continue;
    const isTime=/format-time/.test((n.className||'').toString());
    out.push({mine,isTime,txt});
  }
  // 头部岗位/公司名
  const headEl=document.querySelector('.im-ui-chat-list .im-ui-chat-header, [class*=chat-header]');
  return JSON.stringify({msgs:out.slice(-20), cnt:out.length, head: headEl?headEl.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,120):''});
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
    await sleep(2500);
    const r = JSON.parse((await ev(READ, 20000)) || '{}');
    const real = (r.msgs || []).filter((m) => !m.isTime);
    convs.push({ ...it, head: r.head || '', cnt: r.cnt || 0, msgs: real });
    const last = real[real.length - 1];
    console.log(`[${k + 1}] ${(it.txt || '').slice(0, 40)} || 末条: ${last ? (last.mine ? '我' : '对方') + ': ' + last.txt.replace(/\n/g, ' ').slice(0, 70) : '无(' + (r.cnt || 0) + ')'}`);
  } catch (e) { convs.push({ ...it, err: e.message }); console.log(`[${k + 1}] ERR ${e.message}`); }
  fs.writeFileSync(OUT, JSON.stringify({ ok: true, listLen: list.length, convs }, null, 1));
  await sleep(700);
}
console.log(`\n完成 ${convs.length} -> ${OUT}`);
cdp.ws.close();
