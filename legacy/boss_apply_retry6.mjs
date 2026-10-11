// 对未落库岗位做定点重投：JS click → 读按钮状态 + 捕获弹窗/提示文本
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const urls = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
const ev = (e, ms = 18000) => withTimeout(evalJs(cdp, e), ms);

const BTN = `(function(){
  const a=document.querySelector('a.btn-startchat')||document.querySelector('.btn-startchat-wrap');
  if(!a) return JSON.stringify({btn:null});
  const r=a.getBoundingClientRect();
  return JSON.stringify({btn:(a.innerText||'').trim(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:Math.round(r.width)});
})()`;

const NOTICE = `(function(){
  const els=[...document.querySelectorAll('[class*=dialog],[class*=toast],[class*=modal],[class*=tip]')];
  const txt=els.map(e=>{const r=e.getBoundingClientRect(); return (r.width>10&&r.height>10)?(e.innerText||'').replace(/\\s+/g,' ').trim():'';}).filter(Boolean);
  return JSON.stringify([...new Set(txt)].slice(0,5));
})()`;

const log = [];
for (const u of urls) {
  const rec = { url: u };
  try {
    await withTimeout(navAndWait(cdp, u, 1500), 40000, 'nav');
    let b = JSON.parse((await ev(BTN)) || '{}');
    rec.before = b.btn;
    if (b.btn === '立即沟通' || b.btn === '继续沟通') {
      const r = await ev(`(function(){const a=document.querySelector('a.btn-startchat');if(!a)return 'nf';a.click();return 'clicked';})()`);
      rec.click = r;
      await sleep(2600);
      rec.notice = JSON.parse((await ev(NOTICE)) || '[]');
      b = JSON.parse((await ev(BTN)) || '{}');
      rec.after = b.btn;
      rec.result = b.btn === '继续沟通' ? 'ok' : 'still_ready';
    } else rec.result = 'no_btn';
  } catch (e) { rec.result = 'error'; rec.err = e.message; }
  console.log(JSON.stringify(rec));
  log.push(rec);
  fs.writeFileSync('boss_retry6_log.json', JSON.stringify(log, null, 1));
  await sleep(4000);
}
cdp.ws.close();
