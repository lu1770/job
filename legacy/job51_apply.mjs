// 51job 批量投递：只投递（"立即投递"），不发自定义消息
// 流程：详情页 -> 真实鼠标点击 .apply-btn-new -> 跳转 applysuccess.php = 成功
import fs from 'node:fs';
import { connect, evalJs, sleep, currentId, navAndWait } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const DETAIL_ID = process.argv[2] || currentId();
const TARGET_FILE = process.argv[3] || 'j_apply_targets.json';
const MIN_GAP = Number(process.argv[4] || 25000);
const MAX_GAP = Number(process.argv[5] || 45000);

const targets = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));
const { cdp } = await connect(DETAIL_ID);
await enableVisibility(cdp, VIS_WIDE);

const LOG_FILE = process.argv[6] || 'j_apply_log2.json';
let log = [];
try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
const done = new Set(log.filter((r) => r.result === 'ok' || r.result === 'already').map((r) => String(r.jobId)));
let okCount = 0, skipCount = 0, failCount = 0, resumeCount = 0;
const save = () => fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 1));

async function clickAt(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 40, y: y - 30 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(80 + Math.random() * 80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50 + Math.random() * 60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const BTN_INFO = `(function(){
  const b=document.querySelector('.apply-btn-new');
  if(!b) return {found:false};
  const r=b.getBoundingClientRect();
  const x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);
  const top=document.elementFromPoint(x,y);
  return {found:true,text:(b.innerText||'').trim(),disabled:/disabled/.test(b.className),x,y,
    innerW:innerWidth,innerH:innerHeight,
    inside:(x>0&&y>0&&x<innerWidth&&y<innerHeight),
    hitOk:!!(top&&(top===b||b.contains(top)))};
})()`;

const PAGE_KIND = `(function(){
  const t=document.title||'';
  const b=(document.body.innerText||'').slice(0,600);
  if(/滑动验证|访问验证|验证/.test(t)||/访问验证|请按住滑块/.test(b)) return 'captcha';
  return 'normal';
})()`;

let stopAll = false;
for (let i = 0; i < targets.length; i++) {
  const j = targets[i];
  const tag = `[${i + 1}/${targets.length}] ${j.title} | ${j.sal}`;
  let rec = { ...j };
  if (done.has(String(j.jobId))) { resumeCount++; continue; }
  try {
    await navAndWait(cdp, `https://jobs.51job.com/all/${j.jobId}.html`, 1500);

    const kind = await evalJs(cdp, PAGE_KIND);
    if (kind === 'captcha') {
      rec.result = 'captcha';
      console.log(`${tag} -> 🛑 触发人机验证，停止整批`);
      stopAll = true; break;
    }

    let info = await evalJs(cdp, BTN_INFO);
    if (!info || !info.found) {
      rec.result = 'no_button';
      console.log(`${tag} -> NO_BUTTON`); failCount++; continue;
    }
    if (info.disabled || /已投递/.test(info.text)) {
      rec.result = 'already';
      console.log(`${tag} -> 已投递(skip)`); skipCount++; continue;
    }
    if (!/立即投递|投递/.test(info.text)) {
      rec.result = 'unexpected'; rec.text = info.text;
      console.log(`${tag} -> UNEXPECTED_BTN:${info.text}`); failCount++; continue;
    }
    if (info.inside === false || info.hitOk === false) {
      await evalJs(cdp, `(function(){const b=document.querySelector('.apply-btn-new');if(b)b.scrollIntoView({block:'center',inline:'center'});return 1;})()`);
      await sleep(800);
      const r2 = await evalJs(cdp, BTN_INFO);
      if (r2 && r2.found) info = r2;
      if (info.inside === false || info.hitOk === false) {
        rec.result = 'offscreen'; rec.dbg = { x: info.x, y: info.y, innerW: info.innerW, innerH: info.innerH, hitOk: info.hitOk };
        console.log(`${tag} -> ⚠️ 按钮不在可点区域(x=${info.x},w=${info.innerW})`); failCount++; continue;
      }
    }

    // 投递（最多两次点击；第二次前先复查按钮，避免重复投递）
    let ok = false, lastUrl = '';
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      if (attempt > 0) {
        await sleep(2000);
        const r = await evalJs(cdp, BTN_INFO);
        if (!r || !r.found || r.disabled || /已投递/.test(r.text)) { ok = true; break; }
        info = r;
      }
      await clickAt(info.x, info.y);
      await sleep(2800);
      lastUrl = await evalJs(cdp, 'location.href');
      if (/applysuccess/.test(lastUrl)) { ok = true; break; }
      const info2 = await evalJs(cdp, BTN_INFO);
      if (info2 && (info2.disabled || /已投递/.test(info2.text))) { ok = true; break; }
    }
    if (ok) { rec.result = 'ok'; console.log(`${tag} -> ✅ 投递成功`); okCount++; }
    else { rec.result = 'unknown'; rec.url = lastUrl; console.log(`${tag} -> ⚠️ 状态未知 url=${lastUrl}`); failCount++; }
  } catch (e) {
    rec.result = 'error'; rec.err = e.message;
    console.log(`${tag} -> ❌ ${e.message}`); failCount++;
  } finally {
    log.push(rec); save();
    if (i < targets.length - 1 && !stopAll) {
      await sleep(MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP));
    }
  }
}

console.log(`\n===== 完成: 本次成功 ${okCount} / 本次跳过 ${skipCount} / 本次失败 ${failCount} / 续跑跳过 ${resumeCount} =====`);
if (stopAll) console.log('（因触发人机验证提前终止，剩余岗位未处理）');
cdp.ws.close();
