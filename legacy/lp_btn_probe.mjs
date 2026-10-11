// 探查猎聘详情页按钮区真实状态
import { connect, evalJs, navAndWait, sleep } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
await navAndWait(cdp, process.argv[3], 2500);
await sleep(1500);
const r = await evalJs(cdp, `(function(){
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>30&&r.height>15;};
  const btns=[...document.querySelectorAll('a,button,div,span')].filter(e=>{
    const t=(e.innerText||'').trim();
    return t && t.length<12 && /聊|投|收藏|沟通/.test(t) && vis(e) && e.children.length<=1;
  }).map(e=>({t:e.innerText.trim(),cls:(e.className||'').toString().slice(0,60),tag:e.tagName,w:Math.round(e.getBoundingClientRect().width)}));
  const uniq=[];const seen=new Set();
  for(const b of btns){const k=b.t+'|'+b.cls;if(seen.has(k))continue;seen.add(k);uniq.push(b);}
  return JSON.stringify({url:location.href,title:document.title,buttons:uniq},null,1);
})()`);
console.log(r);
try{cdp.ws.close();}catch{}
