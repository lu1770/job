(()=>{const t=document.body?document.body.innerText.replace(/\s+/g,' '):'';
return JSON.stringify({url:location.href,title:document.title,head:t.slice(0,200),
 hasLogin:/登录\/注册|扫码登录/.test(t.slice(0,500)), len:t.length});})()
