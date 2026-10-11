(()=>{
 const t=document.body?document.body.innerText.replace(/\s+/g,' '):'';
 const hasLogin=txt=>/登录\/注册|请先登录|扫码登录/.test(txt);
 return JSON.stringify({
  url:location.href, title:document.title,
  navLogin:hasLogin(t.slice(0,400)),
  hasMsgBall:!!document.querySelector('.im-ui-basic-entry-title,[class*="im-ui-basic-entry"]'),
  cookieOK:document.cookie.length,
  userEl:(document.querySelector('.header-user-name,[class*="user-name"],[class*="userName"]')||{}).innerText||'',
  antiBot:/验证/.test(t)
 });
})()
