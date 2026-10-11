import { connect, evalJs, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
await navAndWait(cdp, 'https://www.liepin.com/zhaopin/?key=.NET&dq=060080', 3000);
const r = await evalJs(cdp, `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
  const loginBtn=[...document.querySelectorAll('a,button,span,div')].filter(e=>{
    const x=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(登录\\/注册|立即登录|登录)$/.test(x)&&r.width>10&&r.height>10;
  }).map(e=>e.innerText.trim());
  return {href:location.href,hasLoginBtn:loginBtn.length>0,loginBtn,hasUserMenu:/我的简历|退出登录|个人中心/.test(t),cards:document.querySelectorAll('.jobCardPcContainer').length};
})()`);
console.log(JSON.stringify(r, null, 1));
cdp.ws.close();
