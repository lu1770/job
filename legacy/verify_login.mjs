// 只读核验：确认 BOSS / 猎聘 登录态仍有效（不做任何点击/导航）
import { connect, evalJs } from './jlib.mjs';

const BOSS = 'BDD580B38F48764F6263C39173659D90';
const LP = '91BEE956EDE9FC891BDFCAFF8ED77E1B';

async function probe(id, expr) {
  const { cdp, target } = await connect(id);
  let r;
  try { r = await evalJs(cdp, expr); } catch (e) { r = 'ERR:' + e.message; }
  cdp.ws.close();
  return { tab: id.slice(0, 8), url: target.url.slice(0, 90), r };
}

const boss = await probe(BOSS, `JSON.stringify({
  name: (document.body.innerText.match(/路正遥/)||[''])[0],
  loginWall: /登录\\s*\\/\\s*注册|立即登录/.test(document.body.innerText),
  convs: document.querySelectorAll('li .friend-content-warp').length,
  unreadBadge: [...document.querySelectorAll('.notice-badge')].map(x=>x.innerText.trim()).filter(Boolean).length
})`);

const lp = await probe(LP, `JSON.stringify({
  name: (document.body.innerText.match(/路正遥/)||[''])[0],
  loginWall: /登录\\/注册|立即登录/.test(document.body.innerText.slice(0,4000)),
  msgBall: !!document.querySelector('.im-ui-basic-entry-title'),
  btnChat: (document.querySelector('a.btn-chat')||{innerText:''}).innerText,
  alreadyChat: /继续聊|已沟通/.test(document.body.innerText)
})`);

console.log(JSON.stringify({ boss, lp }, null, 1));
