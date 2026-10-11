(()=>{
 const t=document.body?document.body.innerText.replace(/\s+/g,' '):'';
 return JSON.stringify({
  url:location.href, title:document.title, bodyLen:t.length,
  cards:document.querySelectorAll('.jobCardPcContainer').length,
  loginModal:/登录|扫码登录|请登录/.test(document.title)||!!document.querySelector('.ant-modal,.login-dialog,[class*="login"]'),
  slider:/滑动验证|拖动滑块/.test(t),
  head:t.slice(0,160)
 });
})()
