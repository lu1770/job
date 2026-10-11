(()=>{
 const els=[...document.querySelectorAll('.job-card-box .job-salary')].slice(0,6);
 const dec=s=>[...s].map(ch=>{const c=ch.charCodeAt(0); return (c>=57393&&c<=57402)?String(c-57393):ch;}).join('');
 return JSON.stringify(els.map(e=>({raw:e.textContent, codes:[...e.textContent].map(c=>c.charCodeAt(0)), dec:dec(e.textContent)})));
})()
