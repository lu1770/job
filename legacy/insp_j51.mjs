// 探查 51job 搜索页：卡片数量/结构/排序控件
import { connect, evalJs } from './jlib.mjs';
const id = process.argv[2];
const { cdp, target } = await connect(id);
console.log('URL', target.url);

const info = await evalJs(cdp, `(function(){
  const out={};
  out.href=location.href; out.title=document.title;
  const items=[...document.querySelectorAll('.joblist-item')];
  out.itemCount=items.length;
  out.itemCls = items[0] ? items[0].className : '';
  out.sample = items.slice(0,3).map(it=>{
    const sdEl=it.querySelector('[sensorsname]');
    let sd=null; try{sd=JSON.parse(sdEl.getAttribute('sensorsdata'));}catch(e){}
    return {text:(it.innerText||'').replace(/\\s+/g,' ').slice(0,160), sd: sd?{jobId:sd.jobId,title:sd.jobTitle,sal:sd.jobSalary,area:sd.jobArea}:null};
  });
  // 排序控件
  const sortEls=[...document.querySelectorAll('*')].filter(e=>{
    const t=(e.innerText||'').trim();
    return /^(薪资优先|综合排序|最新优先|距离优先|活跃职位优先)$/.test(t) && e.children.length===0;
  }).slice(0,8).map(e=>({t:(e.innerText||'').trim(), cls:e.className, tag:e.tagName}));
  out.sortEls=sortEls;
  // 分页
  const pager=[...document.querySelectorAll('.el-pager li')].map(x=>(x.innerText||'').trim());
  out.pager=pager.slice(0,15);
  out.bodyLen=(document.body.innerText||'').length;
  return JSON.stringify(out);
})()`);
console.log(info);
try { cdp.ws.close(); } catch {}
