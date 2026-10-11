// 诊断：JS 点击 聊一聊 后，立即 dump 所有含"聊/沟通/投递"的元素及其类名
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
const href = process.argv[3];

const DUMP = `(function(){
  const els=[...document.querySelectorAll('a,button,div,span')].filter(e=>{
    const t=(e.innerText||'').trim();
    return t && t.length<16 && /聊|沟通|投递|简历/.test(t) && e.children.length<=1;
  }).map(e=>{const r=e.getBoundingClientRect();return {t:e.innerText.trim(),cls:(e.className||'').toString().slice(0,50),tag:e.tagName,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});
  const seen=new Set();const u=[];
  for(const e of els){const k=e.t+e.cls+e.x+e.y;if(seen.has(k))continue;seen.add(k);u.push(e);}
  return JSON.stringify(u.slice(0,25),null,1);
})()`;

await navAndWait(cdp, href, 2500);
console.log('--- 点击前 ---'); console.log(await evalJs(cdp, DUMP));
const jc = await evalJs(cdp, `(function(){
  const a=[...document.querySelectorAll('a.btn-main,div.apply-box a,a')].find(e=>/^聊一聊$/.test((e.innerText||'').trim()));
  if(!a) return 'nf'; a.click(); return 'clicked';
})()`);
console.log('JS click:', jc);
await sleep(4000);
console.log('--- 点击后 ---'); console.log(await evalJs(cdp, DUMP));
console.log('URL:', await evalJs(cdp, 'location.href'));
try{cdp.ws.close();}catch{}
