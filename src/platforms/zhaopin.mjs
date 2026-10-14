/**
 * 平台适配器：智联招聘
 *
 * ⚠️ 交互模型与其他平台不同：**没有职位详情 URL，走「点卡片 → 右侧详情面板」**
 * （实测：`.job-card` 卡片内唯一的 <a> 是公司页 `companydetail/CZxxxx.htm`，
 *   根本不存在 `/jobdetail/<id>` 这种链接 → 早期用正则抠 id 永远是 0）。
 *
 * 因此本适配器：
 *  - normalize() 不产出 url，改为产出 `cardIndex`（卡片序号）+ `cardKey`（标题|薪资|公司 指纹）；
 *  - applyOne() 回到搜索页 → 按 cardIndex 真实鼠标点卡片 → 用面板标题 `.job-detail-summary__title-text`
 *    校验确实切到了目标岗位 → 再在面板里 JS click「立即投递」；
 *  - 去重靠 cardKey（跨轮次稳定），不靠 URL。
 */
import { evalJson, evalJs, sleep, clickAt, navigate } from '../core/cdp.mjs';
import { makeReadJd } from '../core/readjd.mjs';
import { multiScan } from '../core/multiscan.mjs';
import { fingerprint } from '../core/url.mjs';

/** 智联卡片内没有职位详情 URL，id 靠 cardKey 指纹，不走 URL 正则 */
export const ID_RE = null;

export const id = 'zhaopin';
export const label = '智联招聘';

export const DEFAULT_KEYWORDS = ['.NET', 'C#', '上位机', 'WPF', 'MES'];

export const JL = '639';                       // 苏州
export const SITE = 'https://www.zhaopin.com';
export const pace = { min: 6, max: 12 };

/** 本平台不通过 URL 定位岗位 */
export const detailStrategy = 'panel';

export function searchUrl(keyword) {
  return `${SITE}/jobs?jl=${JL}&kw=${encodeURIComponent(keyword)}`;
}

export const homeUrl = searchUrl('.NET');

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
      loginWall:/登录\\/注册|立即登录/.test(t.slice(0,2000)),
      masked:/\\*\\*-\\*\\*元/.test(t),
      cards:document.querySelectorAll('.job-card').length
    });
  })()`, 15000);
}

// ---------------------------------------------------------------- 采集

/**
 * 卡片信息主要从结构化节点取；vue-clamp 的 innerText 会被截断，标题必须走 aria-label。
 */
const SCAN_CARDS = `(function(){
  return JSON.stringify([...document.querySelectorAll('.job-card')].map((c,i)=>{
    const t=(c.innerText||'').replace(/\\r/g,'');
    const lines=t.split('\\n').map(s=>s.trim()).filter(Boolean);
    const aria=c.querySelector('.job-card__title-clamp [aria-label]');
    const sal=c.querySelector('.job-card__salary');
    const comp=c.querySelector('.job-card__company-name');
    const place=c.querySelector('[class*=workplace],[class*=address],[class*=location]');
    return {
      i,
      title:(aria?aria.getAttribute('aria-label'):(lines[0]||'')).trim(),
      sal:(sal?sal.innerText:'').trim(),
      company:(comp?comp.innerText:'').trim(),
      loc:(place?place.innerText:'').trim() || lines.slice(-2).join(' '),
      tail:lines.slice(-2).join(' ')
    };
  }));
})()`;

/** 单轮：导航 → 排「高薪」→ 扫卡片 */
async function scanOnce(cdp, keyword) {
  await navigate(cdp, searchUrl(keyword), { settle: 3400 });
  const g = await guard(cdp);
  if (!g || g.slider || g.loginWall) return { items: [], stopped: g };
  await sortBySalary(cdp);
  await sleep(3200);
  const items = (await evalJson(cdp, SCAN_CARDS, 20000)) || [];
  return { items: items.filter((j) => j.title), stopped: null };
}

/** 单关键词采集：刷新 N 次合并去重（默认 1 = 关闭；去重键 = 卡片指纹，与 normalize 一致） */
export async function scanKeyword(cdp, keyword, { refresh = 1 } = {}) {
  return multiScan(() => scanOnce(cdp, keyword), {
    refresh,
    keyOf: (j) => fingerprint({ title: j.title, company: j.company, salary: j.sal }),
  });
}

/** 排序「高薪」—— 必须 JS click（真实鼠标会误触「低薪筛选」，URL 出现 sl=0000,4000） */
export async function sortBySalary(cdp) {
  return evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('.jobs-list-sort-placeholder__item')].filter(e=>(e.innerText||'').trim()==='高薪');
    if(!els.length) return 'nf'; els[0].click(); return 'ok';
  })()`, 12000);
}

/**
 * normalize：**不生成 URL**，产出卡片定位信息。
 * cardKey =「标题|薪资|公司」三段指纹 —— 智联岗位没有稳定 URL，这是唯一可靠的去重键。
 */
export function normalize(items) {
  return items.map((j) => {
    const cardKey = fingerprint({ title: j.title, company: j.company, salary: j.sal });
    return { ...j, id: cardKey, cardKey, cardIndex: j.i, url: '' };
  });
}

// ---------------------------------------------------------------- JD

/**
 * 打开岗位详情。无 URL 平台靠「回到搜索页 → 排序高薪 → 点第 cardIndex 张卡片」，
 * 由 pipeline 统一调用；返回面板标题用于校验。
 */
export async function openJob(cdp, item) {
  await backToSearch(cdp, item.kw);
  return selectCard(cdp, item);
}

/**
 * 读 JD **只取右侧详情面板**，不能读 document.body：
 * 整页含搜索列表、推荐职位、页脚，techFlags 会把里面的关键词全命中，
 * 导致每个岗位都「看起来像 C#/上位机」（实测 flags 全量误命中）。
 */
export const readJd = makeReadJd({
  head: `document.querySelector('.job-detail-summary__title-text')||document.querySelector('h1')`,
  scope: `document.querySelector('.job-detail-modules__detail')||document.querySelector('.job-detail-modules')||document.querySelector('.job-detail-summary')`,
});

/** 回到搜索页并重排「高薪」，保证卡片顺序与 cardIndex 一致 */
async function backToSearch(cdp, kw) {
  await navigate(cdp, searchUrl(kw || '.NET'), { settle: 3200 });
  await sortBySalary(cdp);
  await sleep(3000);
}

// ---------------------------------------------------------------- 卡片定位 + 投递

const CARD_POS = (idx) => `(function(){
  const c=document.querySelectorAll('.job-card')[${idx}]; if(!c) return null;
  c.scrollIntoView({block:'center'});
  const r=c.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), i:${idx}});
})()`;

/**
 * 按**标题**定位卡片。
 * 智联列表每次加载/排序后顺序并不稳定（实测 cardIndex 会整体错位一格），
 * 因此优先用 aria-label 标题精确匹配定位，序号只作兜底；点击后还要用面板标题复核。
 */
const CARD_POS_BY_TITLE = (title) => `(function(){
  const cards=[...document.querySelectorAll('.job-card')];
  const t=${JSON.stringify(title)};
  const name=x=>{const a=x.querySelector('.job-card__title-clamp [aria-label]');return a?(a.getAttribute('aria-label')||'').trim():'';};
  let c=cards.find(x=>name(x)===t);
  if(!c) c=cards.find(x=>name(x)&&name(x).indexOf(t)>=0);
  if(!c) return null;
  c.scrollIntoView({block:'center'});
  const r=c.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), i:cards.indexOf(c)});
})()`;

const PANEL = `(function(){
  const t=document.querySelector('.job-detail-summary__title-text');
  return JSON.stringify({ title: t?(t.innerText||'').trim():'' });
})()`;

const FIND_APPLY = `(function(){
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>10&&r.height>10;};
  const stay=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页'&&vis(x));
  if(stay) return JSON.stringify({state:'stay'});
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect();
    return r.width>80&&r.height>25&&r.width<300&&/^(立即投递|已投递|投递简历|已申请|继续沟通)$/.test(t)&&vis(e);
  });
  if(!els.length) return null;
  const done=els.find(e=>/已投递|已申请|继续沟通/.test(e.textContent));
  if(done) return JSON.stringify({state:'done', t:done.textContent.trim()});
  const b=els[0]; const r=b.getBoundingClientRect();
  return JSON.stringify({state:'ready', t:b.textContent.trim(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
})()`;

/** 轮询等待右侧面板标题切换到目标（面板渲染比点击慢，实测需要 3-6s） */
async function waitPanel(cdp, title, { tries = 8, gap = 800 } = {}) {
  let panelTitle = '';
  for (let i = 0; i < tries; i++) {
    await sleep(i === 0 ? 1200 : gap);
    const p = await evalJson(cdp, PANEL, 12000);
    panelTitle = p ? p.title : '';
    if (!title || !panelTitle || panelTitle === title) return { panelTitle, ready: true };
  }
  return { panelTitle, ready: false };
}

/**
 * 点开目标卡片（必须真实鼠标），返回面板标题。
 * 顺序：按标题定位 → 按序号兜底；点击后轮询面板就位。任何一步对不上都不猜。
 */
async function selectCard(cdp, item) {
  const attempts = [];
  if (item.title) attempts.push(CARD_POS_BY_TITLE(item.title));
  if (typeof item.cardIndex === 'number') attempts.push(CARD_POS(item.cardIndex));

  for (const expr of attempts) {
    const pos = await evalJson(cdp, expr, 12000);
    if (!pos) continue;
    await sleep(350);
    await clickAt(cdp, pos.x, pos.y);
    const w = await waitPanel(cdp, item.title);
    if (w.ready) return { ok: true, panelTitle: w.panelTitle };
  }
  const w = await waitPanel(cdp, null, { tries: 2 });
  return { ok: false, why: 'panel_mismatch', panelTitle: w.panelTitle };
}

export async function applyOne(cdp, item) {
  // 回到该关键词的搜索页并重排序，保证 cardIndex 与列表顺序一致
  await backToSearch(cdp, item.kw);

  const sel = await selectCard(cdp, item);
  if (!sel.ok) return { result: 'card_not_found' };
  // 面板标题必须等于目标岗位，否则说明列表顺序漂移了，绝不盲投
  if (item.title && sel.panelTitle && sel.panelTitle !== item.title) {
    return { result: 'panel_mismatch', panelTitle: sel.panelTitle, expect: item.title };
  }

  let ap = await evalJson(cdp, FIND_APPLY, 12000);
  if (!ap) { await sleep(1800); ap = await evalJson(cdp, FIND_APPLY, 12000); }
  if (ap && ap.state === 'stay') {
    await evalJs(cdp, `(()=>{const b=[...document.querySelectorAll('button,span,a')].find(x=>(x.textContent||'').trim()==='留在此页'&&x.getBoundingClientRect().width>10);b&&b.click();return 1})()`, 12000);
    await sleep(1200);
    ap = await evalJson(cdp, FIND_APPLY, 12000);
  }
  if (!ap) return { result: 'no_btn' };
  if (ap.state === 'done') return { result: 'already' };

  const clicked = await evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
      const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect();
      return r.width>80&&r.height>25&&r.width<300&&/^立即投递$/.test(t)&&r.width>10&&r.height>10;
    });
    if(!els.length) return 'nf'; els[0].click(); return 'ok';
  })()`, 12000);
  if (clicked !== 'ok') return { result: 'js_fail' };
  await sleep(2400);

  const ap2 = await evalJson(cdp, FIND_APPLY, 12000);
  if (ap2 && ap2.state === 'done') return { result: 'ok' };
  const g = await guard(cdp);
  if (g && g.slider) return { result: 'slider_blocked' };
  return { result: 'unknown' };
}

export async function probeItem(cdp, item) {
  await backToSearch(cdp, item.kw);
  const sel = await selectCard(cdp, item);
  const ap = await evalJson(cdp, FIND_APPLY, 12000);
  return { title: item.title, panelTitle: sel.panelTitle || null, btn: ap ? `${ap.state}:${ap.t || ''}` : null };
}

// ---------------------------------------------------------------- 记录核验

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

export const chatSupported = false;
export const notes = [
  '智联 PC 端消息能力有限，本工程只做采集/投递/记录核验',
  '岗位无稳定详情 URL，去重靠「标题|薪资|公司」指纹，交互靠卡片序号 + 面板标题双重校验',
];