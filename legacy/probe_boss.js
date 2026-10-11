(()=>{
 const t=document.body?document.body.innerText.replace(/\s+/g,' '):'';
 return JSON.stringify({
  url:location.href, title:document.title, bodyLen:t.length,
  loginWall:location.href.includes('/web/user/')||/登录|注册/.test(document.title),
  cards:document.querySelectorAll('.job-card-box').length,
  slider:/滑动验证|拖动滑块|点击按钮进行验证/.test(t),
  head:t.slice(0,160)
 });
})()
