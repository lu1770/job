// Probe login state on a given URL. Usage: node p_login.mjs <url>
import { connect, evalJs, navAndWait, sleep } from './jlib.mjs';

const url = process.argv[2];
const { cdp, target } = await connect();
console.log('TAB', target.id, '|', target.url.slice(0, 100));
await navAndWait(cdp, url, 2500);
const info = await evalJs(cdp, `(()=>{
  const b = document.body ? document.body.innerText.slice(0,1400) : '';
  return {
    href: location.href,
    title: document.title,
    len: document.body ? document.body.innerText.length : 0,
    hasLoginWord: /登录|注册|立即登录|扫码登录/.test(b),
    hasMe: /Hi[，,]|我的|退出|简历/.test(b),
    snippet: b.replace(/\\n+/g,' | ').slice(0,900)
  };
})()`);
console.log(JSON.stringify(info, null, 1));
try { cdp.ws.close(); } catch {}
