// 测试：真实鼠标点击 BOSS 立即沟通（先关弹窗）
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const url = process.argv[3];
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
const ev = (e, ms = 18000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y: y - 20 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(90);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
await navAndWait(cdp, url, 1500);
const btn = JSON.parse((await ev(`(function(){const a=document.querySelector('a.btn-startchat');if(!a)return 'null';const r=a.getBoundingClientRect();return JSON.stringify({t:a.innerText.trim(),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`)) || 'null');
console.log('btn', JSON.stringify(btn));
await clickAt(btn.x, btn.y);
await sleep(2500);
const d = await ev(`(function(){const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{const t=(e.innerText||'').trim();const r=e.getBoundingClientRect();return t==='好'&&r.width>20&&r.height>15;});if(!els.length)return 'none';els[0].click();return 'dismissed';})()`);
console.log('dismiss', d);
await sleep(1500);
await clickAt(btn.x, btn.y);
await sleep(3000);
const after = await ev(`(function(){const a=document.querySelector('a.btn-startchat');return a?a.innerText.trim():'gone';})()`);
console.log('after', after);
cdp.ws.close();
