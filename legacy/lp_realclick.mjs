// 猎聘单岗兜底：真实鼠标点击 聊一聊 → 等待 → 刷新后复查状态
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';

const TAB = process.argv[2];
const href = process.argv[3];
const { cdp } = await connect(TAB);

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

const STATE = `(function(){
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>30&&r.height>15;};
  const els=[...document.querySelectorAll('a,button,div,span')].filter(e=>/^(聊一聊|继续聊|已沟通|已投递)$/.test((e.innerText||'').trim())&&vis(e));
  const main=els.find(e=>/聊一聊|继续聊|已沟通|已投递/.test(e.innerText));
  const r=main?main.getBoundingClientRect():null;
  const dlg=[...document.querySelectorAll('[class*=dialog],[class*=modal],[class*=popup],[class*=Dialog],[class*=Modal]')].filter(e=>{const b=e.getBoundingClientRect();return b.width>120&&b.height>60;}).map(e=>(e.innerText||'').replace(/\\s+/g,' ').slice(0,160));
  return JSON.stringify({btn:main?main.innerText.trim():'NONE', x:r?Math.round(r.x+r.width/2):0, y:r?Math.round(r.y+r.height/2):0, dialogs:[...new Set(dlg)].slice(0,3), url:location.href});
})()`;

await navAndWait(cdp, href, 2200);
let s = JSON.parse((await ev(STATE)) || '{}');
console.log('点击前:', JSON.stringify(s));
if (s.btn === '聊一聊') {
  await clickAt(s.x, s.y);
  await sleep(3000);
  console.log('真实点击后:', await ev(STATE));
}
// 刷新复查
await navAndWait(cdp, href, 2500);
console.log('刷新后:', await ev(STATE));
cdp.ws.close();
