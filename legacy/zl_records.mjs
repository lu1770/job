// 读取智联"投递记录"页（权威核验）
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const { cdp } = await connect(process.argv[2]);
await enableVisibility(cdp);

async function navHref(url, wait = 4000) {
  await evalJs(cdp, `location.href=${JSON.stringify(url)}`);
  for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await evalJs(cdp, 'document.readyState')) === 'complete') break; } catch {} }
  await sleep(wait);
}

await navHref('https://i.zhaopin.com/schedule');
const tabs = await evalJs(cdp, `(function(){
  const t=[...document.querySelectorAll('a,span,li,div,button')].filter(e=>{
    const x=(e.innerText||'').trim();
    return x && x.length<=8 && /(投递成功|已投递|已沟通|有意向|全部)/.test(x) && e.getBoundingClientRect().width>10;
  }).slice(0,15).map(e=>({t:(e.innerText||'').trim(),tag:e.tagName,cls:String(e.className).slice(0,40)}));
  return JSON.stringify({href:location.href,title:document.title,tabs:[...new Map(t.map(o=>[o.t+o.cls,o])).values()]});
})()`);
console.log(tabs);

// 点"投递成功"页签
const clicked = await evalJs(cdp, `(()=>{const e=[...document.querySelectorAll('a,span,li,div,button')].find(x=>(x.innerText||'').trim()==='投递成功'&&x.getBoundingClientRect().width>10);if(!e)return 'nf';e.click();return 'ok';})()`);
await sleep(4000);
const list = await evalJs(cdp, `(function(){
  const b=(document.body.innerText||'').replace(/\\s+/g,' ');
  const items=[...document.querySelectorAll('[class*=job],[class*=card],li')].filter(e=>/投递|已投|\d{4}-\d{2}-\d{2}/.test(e.innerText||'')&&(e.innerText||'').length<200).slice(0,40);
  return JSON.stringify({clicked:true, len:b.length, head:b.slice(0,900)});
})()`);
console.log('CLICKED', clicked);
console.log(list);
cdp.ws.close();
