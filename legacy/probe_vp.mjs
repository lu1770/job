import { connect, evalJs, sleep, navAndWait } from './jlib.mjs';
const { cdp } = await connect(process.argv[2]);
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
for (const [w, h] of [[2400, 1500], [2700, 1600]]) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h });
  await sleep(500);
  if (process.argv[3]) await navAndWait(cdp, process.argv[3], 1500);
  const r = await evalJs(cdp, `(function(){
    const b=document.querySelector('.apply-btn-new');
    if(!b) return JSON.stringify({innerW:innerWidth,btn:'none'});
    const rect=b.getBoundingClientRect();
    const x=Math.round(rect.x+rect.width/2), y=Math.round(rect.y+rect.height/2);
    const top=document.elementFromPoint(x,y);
    return JSON.stringify({innerW:innerWidth,innerH:innerHeight,btnX:x,btnY:y,inside:x<innerWidth&&y<innerHeight,
      topTag:top?top.tagName:null,isBtn:top?(top===b||b.contains(top)):false});
  })()`);
  console.log(`override ${w}x${h} ->`, r);
}
cdp.ws.close();
