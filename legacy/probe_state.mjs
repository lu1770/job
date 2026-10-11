// 只读核验：登录态 / 风控态。用法: probe_state.mjs <bossTabId> <lpTabId>
import { connect, evalJs } from './jlib.mjs';

const [bossId, lpId] = process.argv.slice(2);

async function probe(id, label, expr) {
  if (!id) return { label, err: 'no id' };
  try {
    const { cdp, target } = await connect(id);
    let r;
    try { r = await evalJs(cdp, expr); } catch (e) { r = 'ERR:' + e.message; }
    cdp.ws.close();
    return { label, tab: id.slice(0, 8), url: target.url.slice(0, 100), r };
  } catch (e) { return { label, err: e.message }; }
}

const boss = await probe(bossId, 'BOSS', `JSON.stringify({
  name: (document.body.innerText.match(/路正遥/)||[''])[0],
  loginWall: /登录\\s*\\/\\s*注册|立即登录|扫码登录/.test(document.body.innerText.slice(0,3000)),
  convs: document.querySelectorAll('li .friend-content-warp').length,
  badges: [...document.querySelectorAll('.notice-badge')].map(x=>x.innerText.trim()).filter(Boolean),
  bodyLen: document.body.innerText.length
})`);

const lp = await probe(lpId, '猎聘', `JSON.stringify({
  name: (document.body.innerText.match(/路正遥|路先生/)||[''])[0],
  loginWall: /登录\\/注册|立即登录|请登录/.test(document.body.innerText.slice(0,3000)),
  risk: /账号行为异常|短信验证|安全验证/.test(document.body.innerText),
  cards: document.querySelectorAll('.jobCardPcContainer').length,
  bodyLen: document.body.innerText.length,
  head: document.body.innerText.slice(0,120).replace(/\\n/g,' ')
})`);

console.log(JSON.stringify({ boss, lp }, null, 1));
