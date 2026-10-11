import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
const CNT=`JSON.stringify({n:document.querySelectorAll('.job-card-box').length,h:document.documentElement.scrollHeight,u:location.href,t:document.title})`;
const urls=[
 'https://www.zhipin.com/web/geek/job?query=.NET&city=101190400',
 'https://www.zhipin.com/web/geek/jobs?query=.NET&city=101190400&salary=406',
 'https://www.zhipin.com/web/geek/job?query=.NET&city=101190400&salary=406'
];
for(const u of urls){
  await navAndWait(cdp,u,3000);
  let before=JSON.parse(await evalJs(cdp,CNT));
  await evalJs(cdp,`window.scrollTo(0,document.documentElement.scrollHeight);'ok'`);
  await sleep(3500);
  await evalJs(cdp,`window.scrollTo(0,document.documentElement.scrollHeight);'ok'`);
  await sleep(3500);
  let after=JSON.parse(await evalJs(cdp,CNT));
  console.log(JSON.stringify({u,before:before.n,after:after.n,h:after.h,url:after.u}));
}
cdp.ws.close();
