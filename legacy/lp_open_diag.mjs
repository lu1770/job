// 猎聘抽屉打开策略诊断：hover→click / JS click / 元素内部坐标
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);

async function mv(x, y) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(80); }
async function clickAt(x, y) {
  await mv(x - 30, y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
const CHK = `(function(){
  const d=document.querySelector('.ant-im-drawer');
  return JSON.stringify({drawer:d?Math.round(d.getBoundingClientRect().width):0, has:document.body.innerText.includes('我的沟通'), vis:document.visibilityState, hidden:document.hidden});
})()`;

await navAndWait(cdp, 'https://www.liepin.com/', 3500);
console.log('首页状态:', await evalJs(cdp, CHK));

const pos = JSON.parse((await evalJs(cdp, `(function(){
  const e=[...document.querySelectorAll('.im-ui-basic-entry-title,[class*=basic-entry]')].map(x=>{const r=x.getBoundingClientRect();return {t:(x.innerText||'').replace(/\\s+/g,''),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};}).filter(o=>o.w>10);
  const p=e.find(x=>/有新消息/.test(x.t))||e[0];
  return p?JSON.stringify(p):'null';
})()`)) || 'null');
console.log('悬浮球:', JSON.stringify(pos));

if (pos) {
  await mv(pos.x, pos.y); await sleep(300);
  await clickAt(pos.x, pos.y); await sleep(3000);
  console.log('策略A(悬停+点击):', await evalJs(cdp, CHK));

  if (!(JSON.parse(await evalJs(cdp, CHK)).drawer > 0)) {
    console.log('JS click:', await evalJs(cdp, `(function(){const e=[...document.querySelectorAll('.im-ui-basic-entry-title,[class*=basic-entry]')].find(x=>/有新消息/.test((x.innerText||'')));if(!e)return 'nf';e.click();return 'ok';})()`));
    await sleep(3000);
    console.log('策略B(JS click):', await evalJs(cdp, CHK));
  }
}
try { cdp.ws.close(); } catch {}
