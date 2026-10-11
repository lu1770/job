// 探测指定标签页 + URL 的登录态。Usage: node probe_login.mjs <tabId> <url>
import { connect, evalJs, navAndWait } from './jlib.mjs';

const tabId = process.argv[2];
const url = process.argv[3];

const { cdp, target } = await connect(tabId);
console.log('TAB', target.id, '|', (target.url || '').slice(0, 90));
await navAndWait(cdp, url, 3000);

const info = await evalJs(cdp, `(function(){
  const t = (document.body ? document.body.innerText : '').replace(/\\s+/g,' ');
  const vis = (e)=>{const r=e.getBoundingClientRect();return r.width>10&&r.height>10;};
  const loginBtns = [...document.querySelectorAll('a,button,span,div')].filter(e=>{
    const x=(e.innerText||'').trim();
    return /^(登录\\/注册|立即登录|登录|注册)$/.test(x) && vis(e);
  }).map(e=>e.innerText.trim());
  const cards = document.querySelectorAll('.jobCardPcContainer').length
             + document.querySelectorAll('.job-card-box').length
             + document.querySelectorAll('.job-card').length;
  return JSON.stringify({
    href: location.href,
    title: document.title,
    len: t.length,
    loginBtns: [...new Set(loginBtns)].slice(0,6),
    hasUserMenu: /我的简历|退出登录|个人中心|我的投递|Hi[，,]/.test(t),
    masked: /\\*\\*-\\*\\*元|\\*\\*\\*/.test(t),
    cards,
    snippet: t.slice(0, 500)
  });
})()`);
console.log(info);
try { cdp.ws.close(); } catch {}
