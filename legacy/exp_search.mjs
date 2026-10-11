import { connect, evalJs, sleep } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
const setVal = `(function(){const i=document.querySelector('.search-input input, input[placeholder="搜索职位、公司"]');
 if(!i) return 'noinput';
 const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
 i.focus(); set.call(i,'.NET'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));
 return i.value;})()`;
console.log('set ->', await evalJs(cdp, setVal));
await sleep(800);
console.log('btn ->', await evalJs(cdp, `(function(){const b=document.querySelector('a.search-btn');if(!b)return 'nobtn';b.click();return 'clicked';})()`));
await sleep(4500);
console.log('after ->', await evalJs(cdp, `JSON.stringify({u:location.href,n:document.querySelectorAll('.job-card-box').length})`));
// try scroll
await evalJs(cdp,`window.scrollTo(0,document.documentElement.scrollHeight);'ok'`); await sleep(3000);
await evalJs(cdp,`window.scrollTo(0,document.documentElement.scrollHeight);'ok'`); await sleep(3000);
console.log('scrolled ->', await evalJs(cdp, `JSON.stringify({u:location.href,n:document.querySelectorAll('.job-card-box').length})`));
cdp.ws.close();
