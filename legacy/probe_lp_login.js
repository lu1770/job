(function(){
  const t=(document.body?document.body.innerText:'').replace(/\s+/g,' ');
  const q=(s)=>document.querySelector(s);
  const loginBtn=[...document.querySelectorAll('a,button,span,div')].filter(e=>{
    const x=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(登录\/注册|立即登录|登录)$/.test(x)&&r.width>10&&r.height>10;
  }).map(e=>({t:e.innerText.trim(),w:Math.round(e.getBoundingClientRect().width)}));
  const cards=document.querySelectorAll('.jobCardPcContainer').length;
  return JSON.stringify({
    href: location.href,
    hasLoginBtn: loginBtn.length>0,
    loginBtn,
    hasUserMenu: /我的简历|退出登录|个人中心/.test(t),
    cards,
    title: document.title
  });
})()
