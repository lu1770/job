(()=>{
 const els=[...document.querySelectorAll('a,div,span,li')].filter(e=>{
   const r=e.getBoundingClientRect(); const t=(e.innerText||'').trim();
   return r.width>20&&r.height>10&&r.width<200&&t.length<=12&&/^(推荐|职位|公司|最新|搜索|全部|地区|经验|薪资)/.test(t);
 }).slice(0,25).map(e=>({t:(e.innerText||'').trim(),cls:(e.className||'').toString().slice(0,45),tag:e.tagName}));
 const inp=document.querySelector('input[type=text],input:not([type]),.search-input input');
 return JSON.stringify({els, hasInput:!!inp, inpPh:inp?inp.placeholder:''});
})()
