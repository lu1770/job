import { connect, evalJs, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const { cdp } = await connect(process.argv[2]);
await enableVisibility(cdp);
const url = process.argv[3] || 'https://jobs.51job.com/all/173839758.html';
await navAndWait(cdp, url, 2500);
const info = await evalJs(cdp, `(function(){
  const t=document.title||'';
  const b=(document.body.innerText||'').slice(0,300);
  const btn=document.querySelector('.apply-btn-new');
  return JSON.stringify({
    href:location.href, title:t,
    captcha:/滑动验证|访问验证|验证/.test(t)||/请按住滑块|访问验证/.test(b),
    btn: btn?((btn.innerText||'').trim()+'|disabled='+/disabled/.test(btn.className)):'none',
    body:b.slice(0,160)
  });
})()`);
console.log(info);
cdp.ws.close();
