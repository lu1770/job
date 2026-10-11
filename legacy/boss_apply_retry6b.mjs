// 定点重投（含"温馨提示"弹窗处理）：关弹窗后再点立即沟通
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const urls = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
const ev = (e, ms = 18000) => withTimeout(evalJs(cdp, e), ms);

const BTN = `(function(){const a=document.querySelector('a.btn-startchat');return a?a.innerText.trim():null;})()`;
const CLICK = `(function(){const a=document.querySelector('a.btn-startchat');if(!a)return 'nf';a.click();return 'clicked';})()`;
const DISMISS = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return (t==='好'||t==='知道了'||t==='确定'||t==='留在此页')&&r.width>20&&r.height>15;
  });
  if(!els.length) return 'none';
  els[0].click(); return 'dismissed:'+els[0].innerText.trim();
})()`;

const log = [];
for (const u of urls) {
  const rec = { url: u.slice(-34) };
  try {
    await withTimeout(navAndWait(cdp, u, 1400), 40000, 'nav');
    rec.before = await ev(BTN);
    if (rec.before === '立即沟通') {
      rec.c1 = await ev(CLICK);
      await sleep(2200);
      rec.dismiss = await ev(DISMISS);
      await sleep(1200);
      rec.c2 = await ev(CLICK);
      await sleep(2600);
      rec.dismiss2 = await ev(DISMISS);
      await sleep(1200);
      rec.after = await ev(BTN);
      rec.result = rec.after === '继续沟通' ? 'ok' : 'still_ready';
    } else rec.result = 'skip:' + rec.before;
  } catch (e) { rec.result = 'error'; rec.err = e.message; }
  console.log(JSON.stringify(rec));
  log.push(rec);
  fs.writeFileSync('boss_retry6b_log.json', JSON.stringify(log, null, 1));
  await sleep(4000);
}
cdp.ws.close();
