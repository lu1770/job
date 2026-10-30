/**
 * 平台适配器：前程无忧 51job
 *
 * 关键特性（实测）：
 *  - 卡片标题无 <a>；jobId 在 [sensorsname] 的 sensorsdata JSON 里；公司名在卡片 .cname；
 *  - 详情页 URL 固定为 https://jobs.51job.com/all/{jobId}.html；
 *  - 投递按钮 .apply-btn-new **必须真实鼠标点击**（与其他平台相反，JS click 无效）；
 *  - 视口必须用 wide（2400×1500，本机缩放 150% 后实际 1600×1000），否则按钮落在视口外点击静默失效；
 *  - 约每 16-20 次详情页访问触发一次滑块，滑块约 3-5 分钟自行过期；命中即停整批；
 *  - PC 网页版**没有消息中心**，回消息只能由用户在 App/微信端操作。
 */
import { evalJson, evalJs, sleep, clickAt, navigate, rand } from '../core/cdp.mjs';
import { makeReadJd } from '../core/readjd.mjs';
import { multiScan } from '../core/multiscan.mjs';
import { cityCodeFor, DEFAULT_CITY } from '../core/city.mjs';

/** 从详情 URL 提取岗位 id（scan / history 共用） */
export const ID_RE = /51job\.com\/all\/(\d+)\.html/;

export const id = 'job51';
export const label = '前程无忧 51job';

export const DEFAULT_KEYWORDS = ['.Net', 'C#', '上位机', 'WPF', 'MES'];

export const VIEWPORT = 'wide';    // 必须 wide
export const pace = { min: 25, max: 45 }; // 秒，必须慢

export function searchUrl(keyword, city = DEFAULT_CITY) {
  const jobArea = cityCodeFor(city, 'job51');
  return `https://we.51job.com/pc/search?jobArea=${jobArea}&keyword=${encodeURIComponent(keyword)}&searchType=2`;
}
export function detailUrl(jobId) { return `https://jobs.51job.com/all/${jobId}.html`; }

/** 登录入口页（扫码 / 微信登录）。login 检测到未登录时会新开标签卡打开它。 */
export const loginUrl = 'https://login.51job.com/login.php';

/** 首页：daily 为平台开专用标签时的起始页（与其他平台的 homeUrl 同语义） */
export const homeUrl = 'https://we.51job.com/pc/my/myjob';

/**
 * 登录态核验：首页会弹「欢迎使用前程无忧 + 验证码」浮层，但登录态可能是正常的，
 * 别据此判为未登录 —— 以「我的职位」页的 Hi,用户名 为准。
 */
export async function loginProbe(cdp) {
  await navigate(cdp, 'https://we.51job.com/pc/my/myjob', { settle: 3200 });
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'');
    const hi=t.match(/Hi[，,]\\s*([^\\n\\s，,]{1,20})/);
    const links=[...document.querySelectorAll('a')];
    const accountLinks=links.filter(a=>/\\/pc\\/my\\/myjob(?:[?#]|$)/i.test(a.getAttribute('href')||''));
    const accountName=accountLinks.map(a=>(a.innerText||'').trim()).find(s=>s&&!/^我的\\s*51job$/i.test(s))||'';
    const accountNav=accountLinks.length>0&&links.some(a=>/退出登录/.test(a.innerText||''));
    const name=hi?hi[1].trim():accountName;
    const loginWall=/^login\\.51job\\.com$/i.test(location.hostname);
    return JSON.stringify({ ok: !loginWall && (!!hi || accountNav), name, loginWall, accountNav, head:t.replace(/\\s+/g,' ').slice(0,80) });
  })()`, 15000);
}

export async function guard(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    const title=document.title||'';
    return JSON.stringify({
      slider:/滑动验证|拖动滑块/.test(t) || /滑动验证/.test(title),
      loginWall: location.href.includes('login.51job.com'),
      title
    });
  })()`, 15000);
}

/**
 * 滑块策略（用户口径）：检测到滑块 → 等 15 分钟 → 刷新页面 → 复查。
 * 供 jd.mjs 识别平台能力的开关；scan/apply 内部直接使用 sliderRecover。
 */
export const sliderWaitMs = 15 * 60 * 1000;

/** 等滑块过期并刷新页面。返回 true=已恢复可继续；false=等待后仍被拦。 */
export async function sliderRecover(cdp, url) {
  console.log(`    ⏳ 检测到滑块，等待 ${sliderWaitMs / 60000} 分钟后刷新页面重试…`);
  await sleep(sliderWaitMs);
  await navigate(cdp, url, { settle: 2600 });
  const g = await guard(cdp);
  if (g && g.slider) { console.log('    ⛔ 刷新后仍在滑块页'); return false; }
  console.log('    ✅ 滑块已解除，继续');
  return true;
}

const SCAN_CARDS = `(function(){
  return JSON.stringify([...document.querySelectorAll('.joblist-item')].map((it,i)=>{
    const raw=it.querySelector('[sensorsname]');
    let jobId='',sal='',area='',title='';
    try{ const o=JSON.parse(raw?raw.getAttribute('sensorsdata'):''); jobId=o.jobId; sal=o.jobSalary; area=o.jobArea; title=o.jobTitle; }catch(e){}
    const cname=it.querySelector('.cname');
    return {i, jobId, sal, area, title, company:cname?(cname.innerText||'').trim():''};
  }));
})()`;

/** 单页扫描（薪资优先排序由调用方先点击） */
export async function scanPage(cdp, keyword, { city = DEFAULT_CITY } = {}) {
  await navigate(cdp, searchUrl(keyword, city), { settle: 3000 });
  const g = await guard(cdp);
  if (g && g.slider) {
    // 滑块：等 15 分钟刷新后重扫一次；仍被拦才报停止
    if (!(await sliderRecover(cdp, searchUrl(keyword, city)))) return { items: [], stopped: g };
    return scanPage(cdp, keyword, { city });
  }
  if (!g || g.loginWall) return { items: [], stopped: g };
  const items = (await evalJson(cdp, SCAN_CARDS, 20000)) || [];
  return { items: items.filter((j) => j.jobId), stopped: null };
}

/** 单轮：先点「薪资优先」再扫（原 scan.mjs scanWithSort 特例收编进适配器） */
async function scanOnce(cdp, keyword, { city = DEFAULT_CITY } = {}) {
  await scanPage(cdp, keyword, { city });
  await sortBySalary(cdp);
  await sleep(2600);
  return scanPage(cdp, keyword, { city });
}

/** 单关键词采集：刷新 N 次合并去重（默认 1 = 关闭） */
export async function scanKeyword(cdp, keyword, { refresh = 1, city = DEFAULT_CITY } = {}) {
  return multiScan(() => scanOnce(cdp, keyword, { city }), { refresh, keyOf: (j) => j.jobId, pauseMs: 3000 });
}

/** 点击「薪资优先」排序 */
export async function sortBySalary(cdp) {
  return evalJs(cdp, `(function(){
    const els=[...document.querySelectorAll('span.ss, .sort-item, [class*=sort]')].filter(e=>/薪资优先/.test(e.innerText||''));
    if(!els.length) return 'nf'; els[0].click(); return 'ok';
  })()`, 12000);
}

/** 翻到第 n 页 */
export async function gotoPage(cdp, n) {
  return evalJs(cdp, `(function(){
    const li=[...document.querySelectorAll('.el-pager li.number')].find(x=>(x.innerText||'').trim()==='${n}');
    if(!li) return 'nf'; li.click(); return 'ok';
  })()`, 12000);
}

export function normalize(items, city = DEFAULT_CITY) {
  return items.map((j) => ({ ...j, url: detailUrl(j.jobId), id: j.jobId, loc: j.area, city: j.area }));
}

export const readJd = makeReadJd({ head: `document.querySelector('h1')||document.querySelector('.jobhead-title')` });

const BTN = `(function(){
  const b=document.querySelector('.apply-btn-new'); if(!b) return null;
  const r=b.getBoundingClientRect();
  const txt=(b.innerText||'').trim();
  const disabled=b.disabled||/disabled/.test(b.className||'')||/已投递|投递成功|申请成功/.test(txt);
  return JSON.stringify({text:txt, disabled, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2),
                         inView: document.elementFromPoint(Math.round(r.x+r.width/2), Math.round(r.y+r.height/2))?1:0});
})()`;

export async function applyOne(cdp, item) {
  const url = item.url || detailUrl(item.jobId);
  await navigate(cdp, url, { settle: 1600 });

  // 风控/拦页优先判：滑块或登录墙时按钮根本不在 DOM，直接报对应结果，不再报 no_btn。
  // 滑块按用户口径等 15 分钟刷新重试，恢复后继续本岗位投递。
  let g0 = await guard(cdp);
  if (g0 && g0.slider) {
    if (!(await sliderRecover(cdp, url))) return { result: 'slider_blocked', guard: g0 };
    g0 = await guard(cdp);
  }
  if (g0 && g0.loginWall) return { result: 'login_wall', guard: g0 };

  const before = await evalJson(cdp, BTN);
  if (!before) return { result: 'no_btn' };
  if (before.disabled) return { result: 'already' };
  if (!before.inView) return { result: 'out_of_viewport' };

  await clickAt(cdp, before.x, before.y);
  await sleep(rand(1500, 2600));
  const curUrl = await evalJs(cdp, 'location.href');
  if (/applysuccess\.php/.test(curUrl)) return { result: 'ok' };

  // 51job 部分岗位点击后弹「确认投递」对话框，需再点一次确认按钮才真正投递。
  const confirmBtn = await evalJs(cdp, `(function(){
    const el=[...document.querySelectorAll('button, a, span, div')].find(e=>{
      const t=(e.innerText||'').trim();
      return /^(确定|确认投递|确认|是的|提交)$/.test(t) && e.offsetParent;
    });
    if(!el) return null;
    const r=el.getBoundingClientRect();
    return JSON.stringify({text:(el.innerText||'').trim(), x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)});
  })()`);
  if (confirmBtn) {
    const cb = JSON.parse(confirmBtn);
    await clickAt(cdp, cb.x, cb.y);
    await sleep(rand(1500, 2200));
    const url2 = await evalJs(cdp, 'location.href');
    if (/applysuccess\.php/.test(url2)) return { result: 'ok' };
    const after2 = await evalJson(cdp, BTN);
    if (after2 && after2.disabled) return { result: 'ok' };
  }

  const after = await evalJson(cdp, BTN);
  if (after && after.disabled) return { result: 'ok' };
  const g = await guard(cdp);
  if (g && g.slider) return { result: 'slider_blocked', guard: g };
  if (g && g.loginWall) return { result: 'login_wall', guard: g };
  return { result: 'unknown' };
}

export async function probeItem(cdp, item) {
  await navigate(cdp, item.url || detailUrl(item.jobId), { settle: 1400 });
  const btn = await evalJson(cdp, BTN);
  return { title: item.title, btn: btn ? btn.text : null, disabled: btn ? !!btn.disabled : null };
}

/** 51job PC 端无消息中心 */
export const chatSupported = false;

export const notes = [
  'PC 网页版没有消息中心，无法自动回消息',
  '每 ~20 次详情页访问触发滑块，命中即停并等待 3-5 分钟自行过期',
  '视口必须 wide，否则真实点击落在视口外静默失效',
];