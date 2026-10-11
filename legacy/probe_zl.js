(()=>{
 const t=(document.body?document.body.innerText:'').replace(/\s+/g,' ');
 return JSON.stringify({url:location.href,title:document.title,len:t.length,
  cards:document.querySelectorAll('.job-card').length,
  cards2:document.querySelectorAll('[class*="job-card"]').length,
  login:/登录|注册/.test(t.slice(0,300)),
  slider:/滑动验证|拖动滑块/.test(t),
  sort:[...document.querySelectorAll('.jobs-list-sort-placeholder__item')].map(e=>(e.innerText||'').trim()),
  head:t.slice(0,200)});
})()
