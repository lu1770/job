// 探查猎聘搜索页卡片 DOM 结构（找 href / 薪资 / 公司）
import { connect, evalJs } from './jlib.mjs';

const tabId = process.argv[2];
const { cdp } = await connect(tabId);

const r = await evalJs(cdp, `(function(){
  const cards=[...document.querySelectorAll('.jobCardPcContainer')];
  const out=[];
  for(let i=0;i<Math.min(3,cards.length);i++){
    const c=cards[i];
    const a=c.querySelector('a[href]');
    out.push({
      i,
      innerText: (c.innerText||'').replace(/\\n+/g,' | ').slice(0,300),
      links: [...c.querySelectorAll('a[href]')].map(x=>x.getAttribute('href')).slice(0,5),
      firstHref: a?a.getAttribute('href'):null
    });
  }
  return JSON.stringify({total:cards.length, sample:out}, null, 1);
})()`);
console.log(r);
try { cdp.ws.close(); } catch {}
