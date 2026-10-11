import { connect, evalJs } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
const k = await evalJs(cdp, `(function(){
  const it=document.querySelector('.joblist-item');if(!it)return 'none';
  const el=it.querySelector('[sensorsname]');if(!el)return 'no-sd';
  let o={};try{o=JSON.parse(el.getAttribute('sensorsdata'));}catch(e){return 'parse-err';}
  return JSON.stringify(Object.keys(o));
})()`);
console.log('sensorsdata keys:', k);
const comp = await evalJs(cdp, `(function(){
  const it=document.querySelector('.joblist-item');if(!it)return '';
  const c=it.querySelector('.cname, [class*=company], .comp_name, a[href*=jobs]');
  return c?c.innerText.trim().slice(0,60):'';
})()`);
console.log('company guess:', comp);
cdp.ws.close();
