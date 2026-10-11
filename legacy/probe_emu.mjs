import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
import { enableVisibility } from './emu.mjs';
const { cdp } = await connect(process.argv[2]);
const r = await enableVisibility(cdp);
console.log('enableVisibility ->', JSON.stringify(r));
await sleep(800);
const m1 = await evalJs(cdp, `JSON.stringify({innerW:window.innerWidth,innerH:window.innerHeight,hidden:document.hidden,dpr:devicePixelRatio,screenW:screen.width,screenH:screen.height})`);
console.log('metrics after:', m1);

await navAndWait(cdp, process.argv[3] || 'https://jobs.51job.com/all/145456009.html', 2500);
const m2 = await evalJs(cdp, `(function(){
  const b=document.querySelector('.apply-btn-new');
  const r=b?b.getBoundingClientRect():null;
  return JSON.stringify({innerW:window.innerWidth,innerH:window.innerHeight,
    btn:r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null,
    scrollX:window.scrollX, docW:document.documentElement.clientWidth});
})()`);
console.log('after nav:', m2);

// 强制再设一次更大的视口
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1600, screenHeight: 1000 });
await sleep(600);
const m3 = await evalJs(cdp, `(function(){
  const b=document.querySelector('.apply-btn-new');
  const r=b?b.getBoundingClientRect():null;
  const x=r?Math.round(r.x+r.width/2):0,y=r?Math.round(r.y+r.height/2):0;
  const top=r?document.elementFromPoint(x,y):null;
  return JSON.stringify({innerW:window.innerWidth,innerH:window.innerHeight,
    btn:r?{x,y}:null, topTag:top?top.tagName:null, topCls:top?String(top.className).slice(0,50):null, isBtn:top?(top===b||(b&&b.contains(top))):false});
})()`);
console.log('after wider override:', m3);
cdp.ws.close();
