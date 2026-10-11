(()=>{
 const out={innerH:window.innerHeight, docH:document.documentElement.scrollHeight, bodyH:document.body.scrollHeight,
  hidden:document.hidden, cards:document.querySelectorAll('.job-card-box').length,
  containers:[]};
 // find scrollable containers
 [...document.querySelectorAll('div,ul,main,section')].forEach(e=>{
   const s=getComputedStyle(e);
   if((s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+100){
     out.containers.push({cls:(e.className||'').toString().slice(0,60), sh:e.scrollHeight, ch:e.clientHeight});
   }
 });
 out.containers=out.containers.slice(0,8);
 out.cityText=(document.querySelector('.city-label,.current-city,[class*="city"]')||{}).innerText||'';
 return JSON.stringify(out);
})()
