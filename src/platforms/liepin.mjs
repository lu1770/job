/**
 * 平台适配器：猎聘
 *
 * 关键特性（实测）：
 *  - 苏州 dq=060080；
 *  - 卡片类名混淆（.jobCardPcContainer），从 innerText 行解析：标题=【 之前，城市=首个【】，薪资正则；
 *  - 详情页「聊一聊」→「继续聊」= 成功；只认 **JS click**；
 *  - 详情页访问约 120 次会触发「账号行为异常，请短信验证」→ 必须停止（该风控会自行过期恢复）；
 *  - 消息中心不是独立页面，是职位页点「继续聊/聊一聊」拉起的抽屉；切会话要真实鼠标点击；
 *  - 读消息必须限定在「聊天窗容器」内（从输入框向上找），否则会读到左侧岗位卡文本。
 */
import { evalJson, evalJs, sleep, clickAt, navigate } from '../core/cdp.mjs';
import { techFlags, detectAgeLimit } from '../core/criteria.mjs';

export const id = 'liepin';
export const label = '猎聘';

export const DEFAULT_KEYWORDS = [
  '.NET', 'C#', '上位机', 'WPF', 'WinForm', 'MES', '运动控制', '工业软件', '自动化软件',
];

export const DQ = '060080'; // 苏州

export function searchUrl(keyword) {
  return `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(keyword)}&dq=${DQ}`;
}

export const homeUrl = 'https://www.liepin.com/zhaopin/';

/** 登录态只读核验（顺带探测风控） */
export async function loginProbe(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'');
    const name=(t.match(/路正遥|路先生/)||[''])[0];
    const loginWall=/登录\\/注册|立即登录|请登录/.test(t.slice(0,3000));
    const risk=/账号行为异常|短信验证|安全验证/.test(t);
    return JSON.stringify({
      ok: !loginWall && !!name && !risk,
      name, loginWall, risk,
      cards:document.querySelectorAll('.jobCardPcContainer').length,
      head:t.replace(/\\s+/g,' ').slice(0,80)
    });
  })()`, 15000);
}

export async function guard(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    return JSON.stringify({
      slider:/滑动验证|拖动滑块|请完成安全验证/.test(t),
      risk:/账号行为异常|短信验证|安全验证/.test(t),
      loginWall: location.href.includes('/user/login') || (/登录\\/注册|立即登录/.test(t) && !/你好/.test(t)),
      bodyLen:t.length
    });
  })()`, 15000);
}

// ---------------------------------------------------------------- 采集

const SCAN_CARDS = `(function(){
  return JSON.stringify([...document.querySelectorAll('.jobCardPcContainer')].map(c=>{
    const txt=(c.innerText||'').replace(/\\n+/g,' | ');
    const a=c.querySelector('a[href]');
    const cityM=txt.match(/【([^】]*)】/);
    const salM=txt.match(/(\\d+(?:\\.\\d+)?\\s*-\\s*\\d+(?:\\.\\d+)?\\s*[kKwW])|(\\d+(?:\\.\\d+)?\\s*[kKwW])/);
    const parts=txt.split(' | ').map(s=>s.trim()).filter(Boolean);
    return {
      title:(txt.split('【')[0]||'').trim(),
      city:cityM?cityM[1]:'',
      sal:salM?salM[0].replace(/\\s+/g,''):'',
      href:a?a.getAttribute('href'):'',
      parts:parts.slice(0,9),
      txt:txt.slice(0,260)
    };
  }));
})()`;

export async function scanKeyword(cdp, keyword, { rounds = 15, settle = 2400 } = {}) {
  await navigate(cdp, searchUrl(keyword), { settle: 3000 });
  const g = await guard(cdp);
  if (!g || g.slider || g.risk || g.loginWall) return { items: [], stopped: g || { reason: 'probe_failed' } };

  let last = 0, stable = 0;
  for (let i = 0; i < rounds; i++) {
    const n = await evalJs(cdp, `document.querySelectorAll('.jobCardPcContainer').length`, 12000);
    if (n === last) { stable++; if (stable >= 3) break; } else stable = 0;
    last = n;
    await evalJs(cdp, 'window.scrollTo(0, document.body.scrollHeight); "ok"', 12000);
    await sleep(settle);
  }
  const items = (await evalJson(cdp, SCAN_CARDS, 20000)) || [];
  return { items: items.filter((j) => j.href), stopped: null };
}

/** 只保留苏州（或城市字段为空但整体文本含苏州） */
export function normalize(items) {
  return items.filter((j) => !j.city || /苏州/.test(j.city) || /苏州/.test(j.txt || ''));
}

// ---------------------------------------------------------------- JD

export async function readJd(cdp) {
  const d = await evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n');
    const h=document.querySelector('h1');
    return JSON.stringify({ title:h?h.innerText.trim():'', body:t.slice(0,5000) });
  })()`, 20000);
  if (!d) return null;
  return { jdTitle: d.title, flags: techFlags(d.body), ageLimit: detectAgeLimit(d.body), body: d.body };
}

// ---------------------------------------------------------------- 投递

const CHAT_BTN = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(聊一聊|继续聊|已沟通|已投递)$/.test(t)&&r.width>40&&r.height>18&&r.width<260;
  });
  if(!els.length) return null;
  const done=els.find(e=>/继续聊|已沟通|已投递/.test(e.innerText));
  if(done) return JSON.stringify({state:'done', text:done.innerText.trim()});
  const b=els[0]; const r=b.getBoundingClientRect();
  return JSON.stringify({state:'ready', text:b.innerText.trim(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
})()`;

export async function applyOne(cdp, item) {
  await navigate(cdp, item.href || item.url, { settle: 1500 });
  const before = await evalJson(cdp, CHAT_BTN);
  if (!before) return { result: 'no_btn' };
  if (before.state === 'done') return { result: 'already' };

  const clicked = await evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
      const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
      return t==='聊一聊'&&r.width>40&&r.height>18&&r.width<260;
    });
    if(!els.length) return 'nf'; els[0].click(); return 'clicked';
  })()`);
  if (clicked !== 'clicked') return { result: 'js_fail' };
  await sleep(2500);

  const after = await evalJson(cdp, CHAT_BTN);
  if (after && after.state === 'done') return { result: 'ok' };
  const url = await evalJs(cdp, 'location.href');
  if (/im\.liepin|\/chat/.test(url)) return { result: 'ok' };
  const g = await guard(cdp);
  if (g && (g.risk || g.slider)) return { result: 'risk_blocked', guard: g };
  return { result: 'unknown' };
}

export async function probeItem(cdp, item) {
  await navigate(cdp, item.href || item.url, { settle: 1400 });
  const btn = await evalJson(cdp, CHAT_BTN);
  return { title: item.title, btn: btn ? `${btn.state}:${btn.text}` : null };
}

// ---------------------------------------------------------------- 沟通

const CONV_ITEMS = `(function(){
  return JSON.stringify([...document.querySelectorAll('.im-ui-contact-list-item')].map((it,i)=>({
    i, txt:(it.innerText||'').replace(/\\n+/g,' | ').trim().slice(0,240),
    unread:/\\[未读\\]|未读/.test(it.innerText||'')
  })));
})()`;

const SCROLL_TO_CONV = (idx) => `(function(){
  const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
  const el=items[${idx}]; if(!el) return 'null';
  let p=el.parentElement;
  while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
  if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
  const r=el.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
})()`;

/** 从输入框向上定位聊天窗容器，避免读到左侧岗位卡 */
const CHAT_READ = `(function(){
  const ta=document.querySelector('textarea.ant-im-input');
  let win=null;
  if(ta){ let p=ta.parentElement; while(p&&p!==document.body){ if(p.querySelectorAll('.text').length>2){win=p;break;} p=p.parentElement; } }
  if(!win) win=document.querySelector('.im-ui-chat-list')||document.querySelector('[class*=chat-list]');
  if(!win) return JSON.stringify({err:'no_win'});
  const out=[];
  for(const n of win.querySelectorAll('.text')){
    let mine=false,p=n;
    while(p){ if(/im-ui-txt\\s+send|im-ui-txt-send/.test((p.className||'').toString())){mine=true;break;} p=p.parentElement; }
    const txt=(n.innerText||'').trim(); if(!txt||txt.length>400) continue;
    out.push({mine, isTime:/format-time/.test((n.className||'').toString()), txt});
  }
  return JSON.stringify({msgs:out.slice(-20), cnt:out.length});
})()`;

const DRAWER_OPEN = `(function(){
  const c=[...document.querySelectorAll('a,div')].filter(e=>/^(继续聊|聊一聊)$/.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>60);
  if(!c.length) return 'nf';
  (c.find(e=>e.className&&e.className.toString().includes('btn-main'))||c[0]).click(); return 'clicked';
})()`;

/** 用职位页把 IM 抽屉拉起来（猎聘消息中心没有独立 URL） */
export async function openChat(cdp, seedItems = []) {
  for (const item of seedItems.slice(0, 6)) {
    await navigate(cdp, item.href || item.url, { settle: 2200 });
    const r = await evalJs(cdp, DRAWER_OPEN, 12000);
    await sleep(4000);
    const n = await evalJs(cdp, `document.querySelectorAll('.im-ui-contact-list-item').length`, 12000);
    if (n > 0) return { opened: true, seed: item.title, click: r };
  }
  return { opened: false };
}

export async function listConversations(cdp, seedItems = []) {
  const o = await openChat(cdp, seedItems);
  if (!o.opened) return { opened: false, list: [] };
  const list = (await evalJson(cdp, CONV_ITEMS, 20000)) || [];
  return { opened: true, list };
}

/**
 * 切会话并读取消息。target 可以是索引，也可以是列表项对象。
 * 优先按「姓名+角色」文本定位（虚拟化列表索引会漂移），失败再回退到索引。
 */
export async function readConversation(cdp, target, { retries = 3 } = {}) {
  const idx = typeof target === 'object' ? target.i : target;
  const label = typeof target === 'object' ? String(target.txt || '').split(' | ')[0].trim() : '';
  const byName = (label ? `(function(){
    const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
    for(let i=0;i<items.length;i++){
      if((items[i].innerText||'').indexOf(${JSON.stringify(label)})<0) continue;
      let p=items[i].parentElement;
      while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=items[i].getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
      const r=items[i].getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    }
    return 'null';
  })()` : null);

  for (let a = 0; a < retries; a++) {
    try {
      const expr = (a === 0 && byName) ? byName : SCROLL_TO_CONV(idx);
      const pos = await evalJson(cdp, expr, 12000);
      if (!pos || pos.w < 20) { await sleep(700); continue; }
      await clickAt(cdp, pos.x, pos.y);
      await sleep(2400);
      const got = await evalJson(cdp, CHAT_READ, 20000);
      if (got && (got.msgs || []).length) return got;
      await sleep(800);
    } catch { /* 重试 */ }
  }
  return null;
}

export async function sendMessage(cdp, { key, text, retries = 3 }) {
  const find = (k) => `(function(){
    const items=[...document.querySelectorAll('.im-ui-contact-list-item')];
    for(let i=0;i<items.length;i++){
      const el=items[i]; if((el.innerText||'').indexOf(${JSON.stringify(k)})<0) continue;
      let p=el.parentElement;
      while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
      if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-100); }
      const r=el.getBoundingClientRect();
      return JSON.stringify({i,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)});
    }
    return 'null';
  })()`;

  let opened = false, conv = null;
  for (let a = 0; a < retries && !opened; a++) {
    const pos = await evalJson(cdp, find(key), 12000);
    if (!pos) return { result: 'conv_not_found' };
    await clickAt(cdp, pos.x, pos.y);
    await sleep(2400);
    const hasInput = await evalJs(cdp, `!!document.querySelector('textarea.ant-im-input')`, 12000);
    conv = pos;
    if (hasInput) opened = true;
  }
  if (!opened) return { result: 'open_failed', conv };

  const filled = await evalJs(cdp, `(function(){
    const ta=document.querySelector('textarea.ant-im-input'); if(!ta) return 'no_input';
    const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
    set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    ta.dispatchEvent(new Event('change',{bubbles:true}));
    return String(ta.value.length);
  })()`, 15000);
  if (filled === 'no_input' || Number(filled) < 5) return { result: 'fill_failed', filled };

  await sleep(600);
  const btn = await evalJson(cdp, `(function(){
    const bs=[...document.querySelectorAll('button,.im-ui-basic-send-btn')].filter(b=>/^发送$/.test((b.innerText||'').trim()));
    const b=bs.find(x=>{const r=x.getBoundingClientRect();return r.width>20&&r.height>15;})||bs[0];
    if(!b) return null; const r=b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
  })()`);
  if (!btn) return { result: 'no_send_btn' };
  await clickAt(cdp, btn.x, btn.y);
  await sleep(2500);
  const left = await evalJs(cdp, `(function(){const ta=document.querySelector('textarea.ant-im-input');return ta?ta.value.length:-1;})()`, 12000);
  return { result: Number(left) === 0 ? 'sent' : 'uncertain', inputLeft: left };
}

/** 平台级节奏建议（秒） */
export const pace = { min: 6, max: 12 };