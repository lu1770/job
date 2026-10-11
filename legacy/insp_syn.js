(()=>{
 const s=document.querySelector('a.synthesis');
 const par=s?s.parentElement:null;
 const sib=par?[...par.children].map(e=>({tag:e.tagName,cls:(e.className||'').toString().slice(0,40),t:(e.innerText||'').trim().slice(0,16),href:e.getAttribute?e.getAttribute('href'):''})):[];
 const r=document.querySelector('.recommend-result-inner');
 return JSON.stringify({syn:s?s.outerHTML.slice(0,400):null, sib,
  innerHead:r?(r.innerText||'').replace(/\s+/g,' ').slice(0,240):''});
})()
