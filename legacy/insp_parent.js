(()=>{
 let e=document.querySelector('.job-card-box'); const chain=[];
 while(e && chain.length<8){const s=getComputedStyle(e);const r=e.getBoundingClientRect();
  chain.push({tag:e.tagName,cls:(e.className||'').toString().slice(0,50),ofy:s.overflowY,sh:e.scrollHeight,ch:e.clientHeight,sh2:e.scrollHeight,h:Math.round(r.height),w:Math.round(r.width)});e=e.parentElement;}
 return JSON.stringify(chain);
})()
