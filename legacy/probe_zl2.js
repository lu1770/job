(()=>{const t=(document.body?document.body.innerText:'').replace(/\s+/g,' ');
return JSON.stringify({url:location.href,title:document.title,guest:/登录\/注册|扫码登录/.test(t.slice(0,400)),head:t.slice(0,180)});})()
