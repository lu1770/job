(()=>{
 const c=document.querySelector('.job-card-box');
 if(!c) return JSON.stringify({err:'no card', cls:[...document.querySelectorAll('[class*="job-card"]')].slice(0,6).map(e=>e.className)});
 const links=[...c.querySelectorAll('a')].map(a=>({cls:a.className,href:a.getAttribute('href')}));
 const salEl=[...c.querySelectorAll('span,div,em')].filter(e=>/K|k|万|薪/.test(e.innerText||'')).slice(0,5).map(e=>({cls:e.className,txt:e.innerText}));
 return JSON.stringify({innerText:c.innerText, cls:c.className, links, salEl,
   html:c.outerHTML.slice(0,1200)});
})()
