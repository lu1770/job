// 只读：读取猎聘右下角消息悬浮球的未读数与当前位置
import { connect, evalJs } from './jlib.mjs';
const TAB = process.argv[2];
const { cdp } = await connect(TAB);
const r = await evalJs(cdp, `(function(){
  const els=[...document.querySelectorAll('.im-ui-basic-entry-title, [class*=entry-title], [class*=basic-entry]')].map(x=>{
    const b=x.getBoundingClientRect();
    return {t:(x.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60), w:Math.round(b.width), h:Math.round(b.height), x:Math.round(b.x+b.width/2), y:Math.round(b.y+b.height/2)};
  }).filter(o=>o.w>10);
  return JSON.stringify({url:location.href.slice(0,70), name:(document.body.innerText.match(/路正遥/)||[''])[0], balls:els});
})()`);
console.log(r);
cdp.ws.close();
