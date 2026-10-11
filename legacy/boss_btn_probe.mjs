// 精确读 BOSS 详情页主 CTA 按钮文本
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const urls = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
const ev = (e, ms = 18000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

const PROBE = `(function(){
  const a=document.querySelector('a.btn-startchat');
  const op=document.querySelector('.op-btn-chat');
  // 更宽范围找主按钮
  const cands=[...document.querySelectorAll('a,button,div,span')].filter(e=>{
    const r=e.getBoundingClientRect(); const t=(e.innerText||'').trim();
    return r.width>90&&r.width<260&&r.height>28&&r.height<70&&t&&t.length<14;
  }).map(e=>({t:(e.innerText||'').trim(), c:(e.className||'').toString().slice(0,40)}));
  return JSON.stringify({
    a_startchat: a?a.innerText.trim():null,
    op_btn: op?op.innerText.trim():null,
    cands: cands.slice(0,6),
    jobState: (document.body.innerText.match(/你与该职位竞争者PK情况|已向对方发送|沟通过/)||[''])[0]
  });
})()`;

for (const u of urls) {
  try {
    await withTimeout(navAndWait(cdp, u, 1500), 40000, 'nav');
    console.log(u.slice(-34), '=>', await ev(PROBE));
  } catch (e) { console.log('ERR', u, e.message); }
  await sleep(1200);
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
cdp.ws.close();
