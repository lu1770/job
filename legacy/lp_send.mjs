// 猎聘发送消息：先用职位页拉起 IM 抽屉 → 按关键词定位会话 → 填 textarea.ant-im-input → 真实鼠标点「发送」
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';

const TAB = process.argv[2];
const FILE = process.argv[3];
const LOG = process.argv[4] || 'lp_send_log.json';
const items = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const targets = JSON.parse(fs.readFileSync('lp_targets_today.json', 'utf8'));

const { cdp } = await connect(TAB);
await enableVisibility(cdp);
const ev = (e, ms = 15000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

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
    (c.find(e=>e.className&&e.className.toString().includes('btn-main'))||c[0]).click(); return 'ok';
  })()`);
  await sleep(4000);
  const n = await ev(`document.querySelectorAll('.im-ui-contact-list-item').length`);
  if (n > 0) { opened = true; console.log('抽屉已打开，会话数', n); break; }
}
if (!opened) { console.log('!! 抽屉未能打开'); fs.writeFileSync(LOG, JSON.stringify({ ok: false }, null, 1)); cdp.ws.close(); process.exit(0); }

const log = [];
for (const it of items) {
  const rec = { key: it.key, text: it.text };
  try {
    const pos = JSON.parse((await ev(`(function(){
      const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
      for(let i=0;i<items.length;i++){
        const el=items[i]; if((el.innerText||'').indexOf(${JSON.stringify(it.key)})<0) continue;
        let p=el.parentElement;
        while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
        if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
        const r=el.getBoundingClientRect();
        return JSON.stringify({i,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),txt:(el.innerText||'').replace(/\\n+/g,' | ').slice(0,100)});
      }
      return 'null';
    })()`)) || 'null');
    if (!pos) { rec.result = 'conv_not_found'; log.push(rec); console.log(it.key, '-> 会话未找到'); continue; }
    await clickAt(pos.x, pos.y);
    await sleep(2400);
    rec.conv = pos.txt;
    const filled = await ev(`(function(){
      const ta=document.querySelector('textarea.ant-im-input'); if(!ta) return 'no_input';
      const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      set.call(ta, ${JSON.stringify(it.text)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      ta.dispatchEvent(new Event('change',{bubbles:true}));
      return String(ta.value.length);
    })()`);
    rec.filled = filled;
    if (filled === 'no_input' || Number(filled) < 5) { rec.result = 'fill_failed'; log.push(rec); console.log(it.key, '-> 填充失败', filled); continue; }
    await sleep(600);
    const btn = JSON.parse((await ev(`(function(){
      const bs=[...document.querySelectorAll('button,.im-ui-basic-send-btn')].filter(b=>/^发送$/.test((b.innerText||'').trim()));
      const b=bs.find(x=>{const r=x.getBoundingClientRect();return r.width>20&&r.height>15;})||bs[0];
      if(!b) return 'null';
      const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),cls:(b.className||'').toString().slice(0,50)});
    })()`)) || 'null');
    if (!btn) { rec.result = 'no_send_btn'; log.push(rec); console.log(it.key, '-> 无发送按钮'); continue; }
    await clickAt(btn.x, btn.y);
    await sleep(2500);
    const left = await ev(`(function(){const ta=document.querySelector('textarea.ant-im-input');return ta?ta.value.length:-1;})()`);
    rec.left = left;
    if (Number(left) === 0) { rec.result = 'sent'; console.log(it.key, '-> ✅ 已发送'); }
    else { rec.result = 'uncertain'; console.log(it.key, '-> ⚠️ 未确认，残留', left); }
  } catch (e) { rec.result = 'error'; rec.err = e.message; console.log(it.key, '-> ❌', e.message); }
  log.push(rec);
  fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
  await sleep(3200);
}
console.log(`\n发送完成: ${log.filter((x) => x.result === 'sent').length}/${items.length} 成功`);
cdp.ws.close();
