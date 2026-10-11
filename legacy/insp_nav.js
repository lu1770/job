(()=>{
 const as=[...document.querySelectorAll('a')].filter(a=>{const t=(a.innerText||'').trim();return t==='职位'||t==='推荐'||t==='最新'||/全部|更多/.test(t);}).slice(0,12);
 return JSON.stringify({nav:as.map(a=>({t:(a.innerText||'').trim(),cls:(a.className||'').toString().slice(0,40),href:a.getAttribute('href')})),
  headerInner:(document.querySelector('.recommend-result-inner')||{innerText:''}).innerText.replace(/\s+/g,' ').slice(0,80)});
})()
