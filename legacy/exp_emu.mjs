import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
console.log('emu set');
await navAndWait(cdp,'https://www.zhipin.com/web/geek/jobs?query=.NET&city=101190400',3000);
const CNT=`JSON.stringify({n:document.querySelectorAll('.job-card-box').length,h:document.documentElement.scrollHeight,hid:document.hidden,ih:window.innerHeight})`;
console.log('after nav', await evalJs(cdp,CNT));
for(let i=0;i<6;i++){
  await evalJs(cdp,`window.scrollTo(0,document.documentElement.scrollHeight);'ok'`);
  await sleep(2800);
  console.log('scroll'+i, await evalJs(cdp,CNT));
}
try{await cdp.send('Emulation.clearDeviceMetricsOverride');}catch{}
cdp.ws.close();
