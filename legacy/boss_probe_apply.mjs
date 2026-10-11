// 只读勘察：BOSS 详情页按钮状态，判定"状态未知"的真实原因
import fs from 'node:fs';
import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const urls = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
const ev = (e, ms = 18000) => withTimeout(evalJs(cdp, e), ms);

const PROBE = `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
  const btns=[...document.querySelectorAll('a,button,div,span')].map(e=>(e.innerText||'').trim())
    .filter(x=>/沟通|投递|已投|继续|聊一聊|已向/.test(x)&&x.length<12);
  return JSON.stringify({
    title:(document.querySelector('h1')||{innerText:''}).innerText.trim().slice(0,40),
    url:location.href,
    loginWall:location.href.includes('/web/user/'),
    slider:/滑动验证|拖动滑块/.test(t),
    closed:/已关闭|停止招聘|职位已下线|该职位已/.test(t),
    btnUniq:[...new Set(btns)].slice(0,8),
    hasStartChat: !!document.querySelector('a.btn-startchat'),
    hasOpBtn: !!document.querySelector('.op-btn-chat'),
    bodyLen:t.length,
    tail:t.slice(-220)
  });
})()`;

for (const u of urls) {
  try {
    await withTimeout(navAndWait(cdp, u, 1500), 40000, 'nav');
    const d = JSON.parse((await ev(PROBE)) || '{}');
    console.log(JSON.stringify({ ...d, want: u.slice(-40) }, null, 1));
  } catch (e) { console.log('ERR', u, e.message); }
  await sleep(1500);
}
cdp.ws.close();
