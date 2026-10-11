// 探查智联搜索页：卡片结构 + 点击首卡后详情面板
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const id = process.argv[2];
const { cdp, target } = await connect(id);
await enableVisibility(cdp);
console.log('URL', target.url);

const info = await evalJs(cdp, `(function(){
  const out={};
  out.href=location.href; out.title=document.title;
  const cards=[...document.querySelectorAll('.job-card')];
  out.cardCount=cards.length;
  out.cardCls = cards[0]?cards[0].className:'';
  out.firstHtml = cards[0]?cards[0].outerHTML.slice(0,1200):'';
  out.firstText = cards[0]?(cards[0].innerText||'').replace(/\\s+/g,' ').slice(0,200):'';
  const a=cards[0]?cards[0].querySelector('a[href]'):null;
  out.firstHref = a?a.getAttribute('href'):null;
  // 排序控件
  out.sortEls=[...document.querySelectorAll('.jobs-list-sort-placeholder__item')].map(e=>({t:(e.innerText||'').trim(),cls:e.className}));
  return JSON.stringify(out);
})()`);
console.log(info);

// 点击首卡，读取详情面板
const at = await evalJs(cdp, `(function(){const c=document.querySelectorAll('.job-card')[0];if(!c)return null;c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
if (at) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
}
const panel = await evalJs(cdp, `(function(){
  const t=document.querySelector('.job-detail-summary__title-text');
  const s=document.querySelector('.job-detail-summary__title');
  const href=location.href;
  const links=[...document.querySelectorAll('.job-detail a[href]')].slice(0,3).map(a=>a.getAttribute('href'));
  const bodyLen=(document.body.innerText||'').length;
  return JSON.stringify({title:t?(t.innerText||'').trim():'',sal:s?((s.innerText||'').trim()).slice(0,80):'',href,links,bodyLen});
})()`);
console.log('PANEL', panel);
try { cdp.ws.close(); } catch {}
