(()=>{
 const t=(document.body.innerText||'').replace(/\s+/g,' ');
 const pager=[...document.querySelectorAll('[class*="page"],[class*="pagination"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>40&&r.height>10;}).slice(0,10).map(e=>({cls:(e.className||'').toString().slice(0,50),txt:(e.innerText||'').replace(/\s+/g,' ').slice(0,40)}));
 return JSON.stringify({pager, txtAroundCount:(t.match(/[^ ]{0,20}\d+[^ ]{0,10}(职位|岗位|个)/g)||[]).slice(0,8), tail:t.slice(-300)});
})()
