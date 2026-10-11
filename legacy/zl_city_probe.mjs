// 核查智联 jl=639 搜索结果的城市字段，确认是否限定苏州
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const { cdp } = await connect(process.argv[2]);
await enableVisibility(cdp, VIS_WIDE);
const KW = process.argv[3] || '上位机软件';

async function navHref(url, wait = 4000) {
  await evalJs(cdp, `location.href=${JSON.stringify(url)}`);
  for (let i = 0; i < 40; i++) { await sleep(400); try { if ((await evalJs(cdp, 'document.readyState')) === 'complete') break; } catch {} }
  await sleep(wait);
}

await navHref(`https://www.zhaopin.com/jobs?jl=639&kw=${encodeURIComponent(KW)}`);

const scan = await evalJs(cdp, `(function(){
  const cards=[...document.querySelectorAll('.job-card')];
  return JSON.stringify(cards.slice(0,20).map(c=>{
    const tt=c.querySelector('.job-card__title-clamp [aria-label]');
    const title=tt?tt.getAttribute('aria-label'):((c.querySelector('.job-card__title-main')||{}).innerText||'').trim();
    const sal=((c.querySelector('.job-card__salary')||{}).innerText||'').trim();
    const comp=((c.querySelector('.job-card__company')||{}).innerText||'').trim().split('\\n')[0];
    const txt=(c.innerText||'').replace(/\\s+/g,' ');
    const city=(txt.match(/(苏州|上海|南京|无锡|常州|南通|杭州|嘉兴|宁波|合肥|深圳|北京|广州|十堰|营口|河北|昆山|常熟|太仓|张家港)[^ ]{0,6}/)||[])[0]||'?';
    const cityEl=c.querySelector('.job-card__area, [class*=area], [class*=city], [class*=tag]');
    return {title:title.slice(0,26), sal, comp:comp.slice(0,22), city, cityEl:cityEl?(cityEl.innerText||'').trim().slice(0,20):''};
  }));
})()`);
console.log('KW=', KW);
try { JSON.parse(scan).forEach(o => console.log(' ', (o.sal||'').padEnd(15), '|', o.title.padEnd(26), '|', o.comp.padEnd(22), '| city:', o.city, '| el:', o.cityEl)); }
catch (e) { console.log(scan); }
cdp.ws.close();
