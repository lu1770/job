/**
 * 平台适配器：BOSS 直聘
 *
 * 关键特性（全部来自实测，勿凭常识改）：
 *  - 搜索页是「推荐视图」，单关键词只返回少量结果且 URL 翻页失效 → 靠多关键词叠加 + 滚动懒加载扩池；
 *  - 薪资数字是 PUA 私有区字体（charCode - 57393）；
 *  - 详情页投递按钮 `a.btn-startchat` 只认 **JS click**，CDP 真实鼠标事件会被静默忽略；
 *  - 已投判据必须精确读按钮文本：`立即沟通`=未投 / `继续沟通`=已投；
 *    页面正文出现的「沟通过 / 已投递」来自推荐位等元素，不可作判据；
 *  - 存在当日沟通总量上限（150 次/日），触顶后弹「温馨提示」且按钮点击不再生效。
 */
import { evalJson, evalJs, sleep, clickAt, navigate } from '../core/cdp.mjs';
import { makeReadJd } from '../core/readjd.mjs';
import { exprFindConv, exprScrollBottom } from '../core/pagejs.mjs';

/** 从详情 URL 提取岗位 id（scan / history 共用） */
export const ID_RE = /job_detail\/([^.]+)\.html/;

export const id = 'boss';
export const label = 'BOSS 直聘';

export const DEFAULT_KEYWORDS = [
  '.NET', 'C#', '上位机', 'WPF', 'WinForm', 'MES',
  '运动控制', '工业软件', '自动化软件', '.NET开发', 'C#开发', '工控', '软件工程师',
];

export const CITY = '101190400'; // 苏州
export const ORIGIN = 'https://www.zhipin.com';
export const CHAT_URL = 'https://www.zhipin.com/web/geek/chat';

export function searchUrl(keyword) {
  return `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(keyword)}&city=${CITY}`;
}

export const homeUrl = 'https://www.zhipin.com/web/geek/chat';

/** 登录态只读核验 */
export async function loginProbe(cdp) {
  const r = await evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'');
    const name=(t.match(/路正遥/)||[''])[0];
    const loginWall=/登录\\s*\\/\\s*注册|立即登录|扫码登录/.test(t.slice(0,3000));
    return JSON.stringify({
      ok: !loginWall && !!name,
      name, loginWall,
      convs:document.querySelectorAll('li .friend-content-warp').length,
      unread:[...document.querySelectorAll('.notice-badge')].map(x=>x.innerText.trim()).filter(Boolean)
    });
  })()`, 15000);
  return r;
}

/** 判断是否已触顶 / 触发风控 */
export async function guard(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    const q=t.match(/您今天已与(\\d+)位BOSS沟通，还剩(\\d+)次沟通机会/);
    return JSON.stringify({
      slider:/滑动验证|拖动滑块|点击按钮进行验证/.test(t),
      loginWall: location.href.includes('/web/user/'),
      quota: q?{used:+q[1],left:+q[2]}:null
    });
  })()`);
}

// ---------------------------------------------------------------- 采集

const SCAN_CARDS = `(function(){
  const dec=s=>[...s].map(ch=>{const c=ch.charCodeAt(0);return (c>=57393&&c<=57402)?String(c-57393):ch;}).join('');
  return JSON.stringify([...document.querySelectorAll('.job-card-box')].map(c=>{
    const a=c.querySelector('a.job-name');
    const sal=c.querySelector('.job-salary');
    const co=c.querySelector('.boss-name');
    const loc=c.querySelector('.company-location');
    return {
      title:(a?(a.innerText||'').trim():''),
      href:a?a.getAttribute('href'):'',
      sal:dec(sal?sal.textContent:''),
      company:(co?(co.innerText||'').trim():''),
      loc:(loc?(loc.innerText||'').trim():'')
    };
  }));
})()`;

const COUNT = `document.querySelectorAll('.job-card-box').length`;

/** 岗位 href 里的 id（去重用）。href 形如 /job_detail/xxxx.html */
function idOf(href) {
  const m = String(href || '').match(/job_detail\/([^.]+)\.html/);
  return m ? m[1] : href;
}

/** 单次加载：导航 → 滚动懒加载 → 扫卡片 */
async function scanOnce(cdp, keyword, { rounds = 25, settle = 2600 } = {}) {
  await navigate(cdp, searchUrl(keyword), { settle: 2200 });
  const g = await guard(cdp);
  if (!g || g.slider || g.loginWall) return { items: [], stopped: g || { reason: 'probe_failed' } };

  let last = 0, stable = 0;
  for (let i = 0; i < rounds; i++) {
    const n = await evalJs(cdp, COUNT, 12000);
    if (n === last) { stable++; if (stable >= 3) break; } else stable = 0;
    last = n;
    await evalJs(cdp, 'window.scrollTo(0, document.body.scrollHeight); "ok"', 12000);
    await sleep(settle);
    const g2 = await guard(cdp);
    if (g2 && (g2.slider || g2.loginWall)) return { items: [], stopped: g2 };
  }
  const items = (await evalJson(cdp, SCAN_CARDS, 20000)) || [];
  return { items: items.filter((j) => j.href), stopped: null };
}

/**
 * 单关键词采集：**刷新 N 次并合并去重**（默认 3 次）。
 *
 * 为什么必须多刷：BOSS 搜索页是「推荐视图」，同一关键词每次加载返回的岗位集**不完全相同**。
 * 实测（2026-10-13，C# + 苏州）：
 *   - 单次加载内部零重复（105 张卡 = 105 个唯一 href）
 *   - 但两次刷新之间 91% 重叠，3 次合并后 105 → 115 条（约 1.10x）
 * 也就是说「重复率高」不是 bug，而是推荐流每次会换掉约 9% 的结果 ——
 * 重复的自动去重，**不重复的那部分正是我们要扩出来的池子**。
 * 只刷 1 次就等于浪费了推荐流的变化。
 *
 * 若某次刷新后池子没增长（推荐流返回完全相同的内容），提前结束，不空耗时间。
 */
export async function scanKeyword(cdp, keyword, { rounds = 25, settle = 2600, refresh = 3 } = {}) {
  const seen = new Map();          // id → 岗位条目（保留首次出现的字段）
  let stopped = null;
  let pass = 0;
  let prevCount = 0;
  const stats = [];

  for (let r = 0; r < Math.max(1, refresh); r++) {
    const res = await scanOnce(cdp, keyword, { rounds, settle });
    if (res.stopped) { stopped = res.stopped; break; }

    let added = 0;
    for (const j of res.items) {
      const id = idOf(j.href);
      if (!id || seen.has(id)) continue;
      seen.set(id, j);
      added++;
    }
    pass++;
    stats.push({ pass: r + 1, got: res.items.length, added });
    prevCount = seen.size;

    // 已经拿到就不再增长（推荐流这次没换内容），再刷也是同样结果
    if (added === 0 && r > 0) break;
    if (r < refresh - 1) await sleep(sleep + 1500);   // 多给一点间隔，别把请求打成突发
  }

  return { items: [...seen.values()], stopped, diagnostic: { refreshes: pass, stats, uniq: prevCount } };
}

/** BOSS 卡片 href 是站内相对路径，必须补成绝对地址，否则 Page.navigate 报 invalid URL */
export function resolveUrl(item) {
  const u = item.url || item.href || '';
  return u.startsWith('/') ? ORIGIN + u : u;
}

export function normalize(items) {
  return items.map((j) => ({ ...j, url: resolveUrl(j) }));
}

// ---------------------------------------------------------------- JD

export const readJd = makeReadJd({ head: `document.querySelector('h1')||document.querySelector('.job-name')` });

// ---------------------------------------------------------------- 投递

const APPLY_BTN = `(function(){
  const a=document.querySelector('a.btn-startchat')||document.querySelector('.btn-startchat-wrap');
  if(!a) return null;
  const t=(a.innerText||'').trim();
  const r=a.getBoundingClientRect();
  return JSON.stringify({text:t, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
})()`;

const STAY_DIALOG = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return t==='留在此页'&&r.width>40&&r.height>15;
  });
  if(!els.length) return null;
  const r=els[0].getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
})()`;

export async function applyOne(cdp, item) {
  await navigate(cdp, resolveUrl(item), { settle: 1500 });
  const before = await evalJson(cdp, APPLY_BTN);
  if (!before) return { result: 'no_btn' };
  if (before.text === '继续沟通') return { result: 'already' };
  if (before.text !== '立即沟通') return { result: 'unexpected_state', btn: before.text };

  const clicked = await evalJs(cdp, `(function(){
    const a=document.querySelector('a.btn-startchat'); if(!a) return 'nf'; a.click(); return 'clicked';
  })()`);
  if (clicked !== 'clicked') return { result: 'js_fail' };
  await sleep(2200);

  for (let k = 0; k < 3; k++) {
    const stay = await evalJson(cdp, STAY_DIALOG);
    if (!stay) break;
    await clickAt(cdp, stay.x, stay.y);
    await sleep(1200);
  }
  await sleep(1000);

  const after = await evalJson(cdp, APPLY_BTN);
  if (after && after.text === '继续沟通') return { result: 'ok' };

  // 触顶时页面会反复弹「沟通机会」提示，点击不再生效 —— 明确归类，别再当未知
  const g = await guard(cdp);
  if (g && g.quota) return { result: 'quota_blocked', quota: g.quota };
  const url = await evalJs(cdp, 'location.href');
  if (/\/web\/geek\/chat|\/chat\//.test(url)) return { result: 'ok' };
  return { result: 'unknown', btn: after ? after.text : null };
}

/** 探测单个岗位详情页状态（只读） */
export async function probeItem(cdp, item) {
  await navigate(cdp, resolveUrl(item), { settle: 1400 });
  const btn = await evalJson(cdp, APPLY_BTN);
  const g = await guard(cdp);
  return { title: item.title, company: item.company, btn: btn ? btn.text : null, quota: g ? g.quota : null };
}

// ---------------------------------------------------------------- 沟通

const CONV_ITEMS = `(function(){
  return JSON.stringify([...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp')).map((li,i)=>{
    const badge=li.querySelector('.notice-badge');
    const preview=li.querySelector('.last-msg-text');
    return {i, badge:badge?badge.innerText.trim():'',
            name:(li.querySelector('.friend-name,.name-text')||{innerText:''}).innerText.trim(),
            preview:preview?preview.innerText.trim().slice(0,160):''};
  }));
})()`;

/** 会话列表定位参数（虚拟化列表，索引会漂移，须按文本定位） */
const CONV = { items: 'li', itemHas: '.friend-content-warp', clickSel: '.friend-content-warp', offset: 120 };
const CONV_COUNT = `document.querySelectorAll('li .friend-content-warp').length`;

export async function openChat(cdp) {
  await evalJs(cdp, `location.href='${CHAT_URL}'; "ok"`, 12000);
  await sleep(7000);
}

export async function listConversations(cdp, { unreadOnly = false, loadMore = 8 } = {}) {
  await openChat(cdp);
  for (let i = 0; i < loadMore; i++) {
    const n = await evalJs(cdp, CONV_COUNT);
    await evalJs(cdp, exprScrollBottom('li .friend-content-warp'));
    await sleep(1200);
    const n2 = await evalJs(cdp, CONV_COUNT);
    if (n2 === n && i > 2) break;
  }
  const list = (await evalJson(cdp, CONV_ITEMS, 25000)) || [];
  return unreadOnly ? list.filter((c) => c.badge) : list;
}

/**
 * 切会话并读取消息。
 * 关键：会话列表是虚拟化渲染的，DOM 索引会随滚动漂移 —— 必须**按姓名定位**，
 * 且点击后用聊天窗头部（ recruiter 姓名）校验「确实切到了目标会话」，否则读到的会是别人的消息。
 */
export async function readConversation(cdp, target, { retries = 3 } = {}) {
  const key = typeof target === 'string' ? target : target.name;
  const fallbackIdx = typeof target === 'object' ? target.i : -1;
  const locate = (byName) => exprFindConv({ ...CONV, text: byName && key ? key : null, index: fallbackIdx });

  let head = '';
  for (let a = 0; a < retries; a++) {
    try {
      const pos = await evalJson(cdp, locate(a === 0), 12000);
      if (!pos || pos.w < 20) { await sleep(700); continue; }
      await clickAt(cdp, pos.x, pos.y);
      await sleep(2600);
      for (let s = 0; s < 3; s++) { await evalJs(cdp, exprScrollBottom('li.message-item')); await sleep(500); }
      const got = await evalJson(cdp, CHAT_READ, 20000);
      if (!got || got.placeholder) { await sleep(800); continue; }
      head = got.head || '';
      // 姓名在头部出现即认为切对了（同名时靠消息内容判断，不阻塞）
      if (!key || head.includes(key)) return got;
    } catch { /* 渲染中，重试 */ }
  }
  const last = await evalJson(cdp, CHAT_READ, 20000);
  return last ? { ...last, unverified: true } : null;
}

/** 发送消息（带"会话确已打开"校验，防发错人）。input 用 execCommand 填充；发送按钮必须精确选择器 + 真实点击 */
export async function sendMessage(cdp, { key, verify, text, retries = 3 }) {
  const headExpr = `(function(){const c=document.querySelector('.chat-conversation');
    return c?c.innerText.replace(/\\s*\\n\\s*/g,' | ').slice(0,140):'';})()`;

  let opened = false, head = '', found = null;
  for (let a = 0; a < retries && !opened; a++) {
    const pos = await evalJson(cdp, exprFindConv({ ...CONV, text: key }), 12000);
    if (!pos) return { result: 'conv_not_found' };
    found = pos.txt;
    await clickAt(cdp, pos.x, pos.y);
    await sleep(2600);
    head = await evalJs(cdp, headExpr, 12000);
    if (String(head).includes(verify)) opened = true;
  }
  if (!opened) return { result: 'open_failed', head, found };

  const before = await evalJs(cdp, `document.querySelectorAll('li.message-item .message-content').length`, 12000);
  const inserted = await evalJs(cdp, `(function(){
    const el=document.querySelector('#chat-input'); if(!el) return 'no_input';
    el.focus(); document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return String(el.innerText.trim().length);
  })()`, 15000);
  if (inserted === 'no_input' || Number(inserted) < 5) return { result: 'insert_failed', inserted, head };

  await sleep(700);
  // 注意：不能�� [class*="btn-send"]，会先命中图片按钮 btn-sendimg，点了没反应
  const btn = await evalJson(cdp, `(function(){
    const b=document.querySelector('.btn-send.btn-sure-v2'); if(!b) return null;
    const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
  })()`);
  if (!btn) return { result: 'no_send_btn', head };
  await clickAt(cdp, btn.x, btn.y);
  await sleep(2800);
  const after = await evalJs(cdp, `document.querySelectorAll('li.message-item .message-content').length`, 12000);
  const left = await evalJs(cdp, `(function(){const el=document.querySelector('#chat-input');return el?el.innerText.trim().length:-1;})()`, 12000);
  const ok = Number(left) === 0 && Number(after) > Number(before);
  return { result: ok ? 'sent' : 'uncertain', head, found, before, after, inputLeft: left };
}

/** 平台级节奏建议（秒） */
export const pace = { min: 6, max: 12 };