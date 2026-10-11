// 探查 51job 排序与薪资筛选控件
import { connect, evalJs } from './jlib.mjs';
const id = process.argv[2];
const { cdp } = await connect(id);

const info = await evalJs(cdp, `(function(){
  const out={};
  // 所有含"薪资/排序"字样的短文本元素
  const cands=[...document.querySelectorAll('a,span,li,div,button')].filter(e=>{
    const t=(e.innerText||'').trim();
    return t.length<=8 && /(薪资优先|综合排序|最新优先|月薪范围|薪资|排序)/.test(t) && e.children.length<=2;
  }).slice(0,40).map(e=>({t:(e.innerText||'').trim(),cls:String(e.className).slice(0,60),tag:e.tagName}));
  const seen=new Set(); out.cands=cands.filter(c=>{const k=c.t+c.cls;if(seen.has(k))return false;seen.add(k);return true;});
  // 排序栏容器
  const bar=[...document.querySelectorAll('*')].find(e=>/(综合排序|薪资优先)/.test(e.innerText||'') && (e.innerText||'').length<60);
  out.barHtml = bar? bar.outerHTML.slice(0,900):'';
  return JSON.stringify(out,null,1);
})()`);
console.log(info);
try { cdp.ws.close(); } catch {}
