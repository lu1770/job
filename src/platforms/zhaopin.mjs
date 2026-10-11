/**
 * 平台适配器：智联招聘
 *
 * 关键特性（实测）：
 *  - 苏州 jl=639；split 布局（.job-card 列表 + 右侧详情面板）；
 *  - 每页仅 20 卡、无翻页控件、window 滚动加载失效 → 靠多关键词扩池 + 排序「高薪」；
 *  - 排序「高薪」必须 JS click（用真实鼠标点会误触「低薪筛选」，URL 出现 sl=0000,4000）；
 *  - 卡片标题 vue-clamp 渲染后 innerText 为空，标题/薪资从 .job-card__title-clamp [aria-label] 与 .job-card__salary 读；
 *  - 投递按钮文本「立即投递」，用 JS click；
 *  - 弹窗「留在此页」存在 0×0 隐藏残影，判活必须加 width>10；
 *  - Page.navigate 在此站可能挂死 → 统一走 location.href + readyState 轮询（core.cdp.navigate 已处理）。
 */
import { evalJson, evalJs, sleep, navigate } from '../core/cdp.mjs';
import { techFlags, detectAgeLimit } from '../core/criteria.mjs';

export const id = 'zhaopin';
export const label = '智联招聘';

export const DEFAULT_KEYWORDS = ['.NET', 'C#', '上位机', 'WPF', 'MES'];

export const JL = '639'; // 苏州
export const pace = { min: 6, max: 12 };

export function searchUrl(keyword) { return `https://www.zhaopin.com/jobs?jl=${JL}&kw=${encodeURIComponent(keyword)}`; }

/**
 * 登录态核验：游客态的标志是「薪资打码 **-**元」；未登录会跳登录页。
 */
export async function loginProbe(cdp) {
  await navigate(cdp, searchUrl('.NET'), { settle: 3200 });
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'');
    const loginWall=/登录\\/注册|立即登录/.test(t.slice(0,2000));
    const masked=/\\*\\*-\\*\\*元/.test(t);
    return JSON.stringify({
      ok: !loginWall && !masked,
      name:'', loginWall, masked,
      cards:document.querySelectorAll('.job-card').length,
      head:t.replace(/\\s+/g,' ').slice(0,80)
    });
  })()`, 15000);
}

export async function guard(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    return JSON.stringify({
      slider:/滑动验证|拖动滑块|请完成安全验证/.test(t),
      loginWall: /登录\\/注册|立即登录/.test(t.slice(0,3000)) && !/已登录|我的/.test(t.slice(0,3000)),
      masked: /\\*\\*-\\*\\*元/.test(t), // 游客态薪资打码
      url: location.href
    });
  })()`, 15000);
}

const SCAN_CARDS = `(function(){
  return JSON.stringify([...document.querySelectorAll('.job-card')].map((c,i)=>{
    const t=c.querySelector('.job-card__title-clamp [aria-label]');
    const s=c.querySelector('.job-card__salary');
    const a=c.querySelector('a[href*="/jobdetail/"], a.job-card-box-link');
    return {i,
      title:t?(t.getAttribute('aria-label')||t.innerText||'').trim():'',
      sal:s?(s.innerText||'').trim():'',
      href:a?a.getAttribute('href'):'',
      company:(c.innerText||'').replace(/\\n+/g,' | ').slice(0,160)};
  }));
})()`;

export async function scanKeyword(cdp, keyword) {
  await navigate(cdp, searchUrl(keyword), { settle: 3200 });
  const g = await guard(cdp);
  if (!g || g.slider || g.loginWall) return { items: [], stopped: g };

  let cardCount = 0;
  for (let i = 0; i < 8; i++) {
    cardCount = await evalJs(cdp, `document.querySelectorAll('.job-card').length`, 12000) || 0;
    if (cardCount > 0) break;
    await sleep(500);
  }

  if (!cardCount) {
    const diagnostic = await evalJson(cdp, `(function(){
      const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
      return JSON.stringify({
        url:location.href,
        title:document.title,
        bodyHead:t.slice(0,120),
        cardCount:document.querySelectorAll('.job-card').length
      });
    })()`, 12000);
    return { items: [], stopped: null, diagnostic };
  }

  const items = (await evalJson(cdp, SCAN_CARDS, 20000)) || [];
  return { items: items.filter((j) => j.href), stopped: null };
}

/** 排序「高薪」—— 必须 JS click */
export async function sortBySalary(cdp) {
  return evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('.jobs-list-sort-placeholder__item')]
      .filter(e=>(e.innerText||'').trim()==='高薪');
    if(!els.length) return 'nf'; els[0].click(); return 'ok';
  })()`, 12000);
}

export function normalize(items) {
  return items.map((j) => {
    let u = j.href;
    if (u && u.startsWith('/')) u = 'https://sou.zhaopin.com' + u;
    return { ...j, url: u, id: (u || '').match(/jobdetail\/(\d+)/)?.[1] || '' };
  });
}

export async function readJd(cdp) {
  const d = await evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n');
    const h=document.querySelector('.job-detail-summary__title-text')||document.querySelector('h1');
    return JSON.stringify({ title:h?(h.innerText||'').trim():'', body:t.slice(0,5000) });
  })()`, 20000);
  if (!d) return null;
  return { jdTitle: d.title, flags: techFlags(d.body), ageLimit: detectAgeLimit(d.body), body: d.body };
}

const APPLY = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return /^(立即投递|已投递|继续沟通|投递成功|已申请)$/.test(t)&&r.width>50&&r.height>20;
  });
  if(!els.length) return null;
  const done=els.find(e=>/已投递|继续沟通|投递成功|已申请/.test(e.innerText));
  if(done) return JSON.stringify({state:'done', text:done.innerText.trim()});
  const b=els[0]; const r=b.getBoundingClientRect();
  return JSON.stringify({state:'ready', text:b.innerText.trim(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
})()`;

const STAY = `(function(){
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
    return t==='留在此页'&&r.width>40&&r.height>15;   // 必须 width>10，残影是 0×0
  });
  if(!els.length) return null;
  const r=els[0].getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
})()`;

export async function applyOne(cdp, item) {
  await navigate(cdp, item.url, { settle: 1800 });
  let st = await evalJson(cdp, APPLY);
  if (!st) return { result: 'no_btn' };
  if (st.state === 'done') return { result: 'already' };

  const clicked = await evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
      const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
      return t==='立即投递'&&r.width>50&&r.height>20; });
    if(!els.length) return 'nf'; els[0].click(); return 'clicked';
  })()`);
  if (clicked !== 'clicked') return { result: 'js_fail' };
  await sleep(2200);

  for (let k = 0; k < 3; k++) {
    const stay = await evalJson(cdp, STAY);
    if (!stay) break;
    await evalJs(cdp, `(function(){
      const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
        const t=(e.innerText||'').trim(); const r=e.getBoundingClientRect();
        return t==='留在此页'&&r.width>40&&r.height>15; });
      if(!els.length) return 'nf'; els[0].click(); return 'ok'; })()`);
    await sleep(1200);
  }
  st = await evalJson(cdp, APPLY);
  if (st && st.state === 'done') return { result: 'ok' };
  const g = await guard(cdp);
  if (g && g.slider) return { result: 'slider_blocked' };
  return { result: 'unknown' };
}

/** 权威核验：投递记录页「投递成功」页签 */
export async function verifyRecords(cdp) {
  await navigate(cdp, 'https://i.zhaopin.com/schedule', { settle: 3000 });
  return evalJson(cdp, `(function(){
    const tabs=[...document.querySelectorAll('a,span,div')].filter(e=>/投递成功/.test((e.innerText||'').trim()));
    if(tabs.length) tabs[0].click();
    return JSON.stringify({ok: tabs.length>0});
  })()`, 12000);
}

export async function readRecords(cdp, limit = 60) {
  return evalJson(cdp, `(function(){
    const rows=[...document.querySelectorAll('[class*=record], [class*=item], tr')].slice(0,${limit});
    return JSON.stringify(rows.map(r=>(r.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160)).filter(Boolean));
  })()`, 20000);
}

export async function probeItem(cdp, item) {
  await navigate(cdp, item.url, { settle: 1400 });
  const st = await evalJson(cdp, APPLY);
  return { title: item.title, btn: st ? `${st.state}:${st.text}` : null };
}

export const chatSupported = false;
export const notes = ['智联 PC 端消息能力有限，本工程只做采集/投递/记录核验'];