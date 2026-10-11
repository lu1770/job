(()=>{const t=(document.body?document.body.innerText:'').replace(/\s+/g,' ');
return JSON.stringify({url:location.href,title:document.title,len:t.length,hi:/Hi[，,]\s*\S/.test(t),head:t.slice(0,150)});})()
