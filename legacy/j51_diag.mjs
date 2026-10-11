// 诊断 51job 投递按钮点击为何无效
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const { cdp } = await connect(process.argv[2]);
await enableVisibility(cdp);
const url = process.argv[3] || 'https://jobs.51job.com/all/145456009.html';
await navAndWait(cdp, url, 2500);

const d1 = await evalJs(cdp, `(function(){
  const b=document.querySelector('.apply-btn-new');
  if(!b) return 'no-btn';
  const r=b.getBoundingClientRect();
  const x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);
  const top=document.elementFromPoint(x,y);
  return JSON.stringify({
    href:location.href,
    tag:b.tagName, cls:String(b.className), text:(b.innerText||'').trim(),
    rect:{x,y,w:Math.round(r.width),h:Math.round(r.height)},
    hidden: document.hidden,
    innerH: window.innerHeight, innerW: window.innerWidth,
    topTag: top?top.tagName:null, topCls: top?String(top.className).slice(0,60):null,
    isBtnOrChild: top? (top===b || b.contains(top)) : false,
    html: b.outerHTML.slice(0,300)
  });
})()`);
console.log('BEFORE', d1);

const box = JSON.parse(d1);
if (box && box.rect) {
  const { x, y } = box.rect;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 30, y: y - 20 });
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(120);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(3000);
}

const d2 = await evalJs(cdp, `(function(){
  const b=document.querySelector('.apply-btn-new');
  const dialogs=[...document.querySelectorAll('div,section')].filter(e=>{
    const r=e.getBoundingClientRect();
    return r.width>200&&r.height>100&&e.offsetParent!==null && /确认|确定|投递|简历|取消/.test(e.innerText||'') && (e.innerText||'').length<160;
  }).slice(0,4).map(e=>(e.innerText||'').replace(/\\s+/g,' ').slice(0,100));
  return JSON.stringify({
    href:location.href,
    title:document.title.slice(0,60),
    btn: b? ((b.innerText||'').trim()+'|cls='+String(b.className)) : 'none',
    dialogs
  });
})()`);
console.log('AFTER', d2);
cdp.ws.close();
