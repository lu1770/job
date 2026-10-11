import { connect, evalJs, sleep } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
await evalJs(cdp, `location.href='https://www.zhipin.com/web/geek/chat';'sent'`);
await sleep(7000);
const st = await evalJs(cdp, `JSON.stringify({u:location.href,t:document.title,n:document.querySelectorAll('.friend-content-warp').length})`);
console.log('state:', st);
cdp.ws.close();
