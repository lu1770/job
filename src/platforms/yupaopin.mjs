/**
 * 平台适配器：鱼泡直聘（www.yupao.com）
 *
 * ⚠️ 本适配器的所有结构事实均来自 2026-10-13 CDP 实测，**不要凭常识改**。
 *    鱼泡有阿里云 WAF（acw_sc__v2 JS 挑战），curl 只能拿到 4.8KB 挑战页 ——
 *    必须走真实浏览器，本适配器因此只能配合 CDP 使用。
 *
 * 实测要点：
 *  - 站点是 React + antd，**class 名全部混淆**（acccd / ahea / agbe…），不可作选择器依据。
 *    本文件一律走「语义定位」：靠 href 形态 + 文本特征 + 几何尺寸找元素。
 *  - 搜索页：`/topic/a221c0/?keywords=<kw>`，a221=苏州，c0=全部职位分类。
 *  - 卡片锚点：**每张卡片恰好一个公司链接 `/qiye/<id>.html`**，
 *    从它向上找到「含 1 个 /qiye/ 链接 + 1 个 /zhaogong/ 链接 + 高度 90~420 + 文本含『元/』」
 *    的容器即为整卡 —— 这是唯一稳定的定位方式（试过详情链接向上找，会切到半张卡）。
 *  - 卡片文本行序固定：行0=标题，行1=薪资，其后=标签/公司/区域。
 *  - 详情页 URL：`/zhaogong/{数字ID}/{token}.html`。**token 每次都变，数字ID 才是稳定岗位ID**。
 *  - 列表是**纯滚动懒加载**，实测无翻页按钮：16 → 31 → 46 → 61 → 76 → 90 → 105（6 次滚动）。
 *  - 详情页投递按钮：`发送简历`（本体是 SPAN，靠 React root 事件委托，JS click 有效）；
 *    **页面上有两个「发送简历」**，第二个在「相同职位推荐」区且位于视口外 → 必须加视口内+未遮挡过滤；
 *  - 详情页薪资写作 `8千-1.2万/月`，core/salary.mjs 解析为 0 → 必须由 normalize() 归一化。
 *  - 登录态：右上角「登录丨注册」= 游客；「消息 / 简历 / 路正遥」= 已登录（实测本机已登录）。
 *  - 岗位招满后标题区显示「**已招满**」并**撤掉投递按钮** → 必须与「按钮没渲染」区分，
 *    否则会当 no_btn 无限重投。token 失效时 URL 跳「页面找不到」，也别当投递失败。
 */
import { evalJson, evalJs, sleep, clickAt, navigate, rand } from '../core/cdp.mjs';
import { techFlags, detectAgeLimit } from '../core/criteria.mjs';
import { parseSalary } from '../core/salary.mjs';

export const id = 'yupaopin';
export const label = '鱼泡直聘';

export const DEFAULT_KEYWORDS = [
  '.NET', 'C#', '上位机', 'WPF', 'WinForm', 'MES', '软件工程师',
];

/** 苏州在鱼泡的站点编码：/topic/a221c0/ → a=区域(221 苏州)，c=职位分类(0 全部) */
export const CITY_CODE = 'a221';
export const CAT_ALL = 'c0';
export const SITE = 'https://www.yupao.com';

export const VIEWPORT = 'wide';           // 布局宽，且投递要真实鼠标兜底 → 必须 wide
export const pace = { min: 15, max: 30 }; // 有 WAF + 访问量未知，宁慢勿快

/**
 * 岗位 ID 正则 —— `commands/scan.mjs` 与 `commands/history.mjs` 统一从这里取。
 * 必须只捕获**数字ID**：详情页 URL 是 `/zhaogong/486969794/<随机token>.html`，
 * token 每次都变，写成 `/zhaogong\/(.+)\//` 会把 token 当成岗位 ID，去重直接失效。
 *
 * 用 `(?:yupao\.com)?\/zhaogong\/(\d+)` 而非 `yupao\.com\/zhaogong\/(\d+)`：
 * 采集产物里 `href` 是站内相对路径（`/zhaogong/…`），只带 host 的正则匹配不上。
 * （与 liepin 的 `liepin\.com\/(?:a|job)\/(\d+)` 不同 —— 那个平台的 href 是绝对地址。）
 */
export const ID_RE = /(?:yupao\.com)?\/zhaogong\/(\d+)/;

export function searchUrl(keyword) {
  return `${SITE}/topic/${CITY_CODE}${CAT_ALL}/?keywords=${encodeURIComponent(keyword)}`;
}

export const homeUrl = `${SITE}/${CITY_CODE}/`;

// ---------------------------------------------------------------- 登录 / 风控

/**
 * 登录态核验。
 *
 * 判据用右上角的 **「登录丨注册」→ 登录后变成「消息 / 简历 / <用户名>」**。
 * ⚠️ 不要用「点击登录，立即与老板沟通」当搜索页判据 —— 那是详情页的文案，
 *    搜索页未登录时也未必出现（实测游客态与登录态的搜索页头部差异才是可靠的）。
 * 已实测本机 Profile 1 为登录态，页面显示 `路正遥`。
 */
export async function loginProbe(cdp) {
  await navigate(cdp, searchUrl('.NET'), { settle: 5000 });
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'');
    const head=t.slice(0,1200);
    // 未登录：右上角为「登录丨注册」；登录后：出现「消息」「简历」与用户名
    const guest=/登录\\s*[丨|]\\s*注册/.test(head.replace(/\\s+/g,' '));
    const name=(head.match(/(路正遥)/)||[])[1] || '';
    const hasNav=/消息/.test(head) && /简历/.test(head);
    const waf=/acw_sc__v2|aliyunwaf|滑动验证|拖动滑块|请完成安全验证/.test(t);
    return JSON.stringify({
      ok: !guest && hasNav && !waf,
      name, guest, hasNav, waf,
      cards: document.querySelectorAll('a[href*="/qiye/"]').length,
      head: t.replace(/\\s+/g,' ').slice(0,80)
    });
  })()`, 20000);
}

/**
 * 风控 / 登录墙 / WAF 挑战探测。
 *
 * ⚠️ 实测坑：鱼泡的滑块页**标题是「滑动验证页面」但正文没有「滑动验证」四字**，
 *    正文是「访问验证 / 别离开… / 请按住滑块，拖动到最右边」。
 *    只按 `滑动验证|拖动滑块` 判会漏检 → guard 返回 false → applyOne 误报 `no_btn`，
 *    而真实情况是「被风控了，该停」。
 *    详情页连着访问 ~5 次即触发（实测 jd 跑 6 条后开始出现），故关键词必须覆盖正文文案。
 */
export async function guard(cdp) {
  return evalJson(cdp, `(function(){
    const t=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    const title=document.title||'';
    return JSON.stringify({
      slider:/滑动验证|拖动滑块|访问验证|请按住滑块|aliyunCaptcha|别离开/.test(t+' '+title),
      waf:/acw_sc__v2|aliyunwaf/.test(document.documentElement.innerHTML.slice(0,5000)),
      notFound:/页面找不到|哎呀/.test(title),
      loginWall: !!document.querySelector('a[href*="/zhaogong/"]') && /点击登录[，,]?\\s*立即与老板沟通/.test(t),
      loginPage: /\\/login|\\/reg\\b/.test(location.pathname),
      title,
      cards: document.querySelectorAll('a[href*="/qiye/"]').length
    });
  })()`, 20000);
}

// ---------------------------------------------------------------- 采集

/**
 * 扫描全部卡片。定位见文件头说明：以公司链接为锚点向上找整卡容器。
 * 刻意不依赖任何 class —— 鱼泡每次构建都会重新混淆。
 */
const SCAN_CARDS = `(function(){
  const qiye=[...document.querySelectorAll('a')].filter(a=>/\\/qiye\\//.test(a.getAttribute('href')||''));
  const out=[];
  for(const q of qiye){
    let p=q.parentElement, card=null;
    for(let i=0;i<6&&p;i++,p=p.parentElement){
      const txt=p.innerText||'';
      const r=p.getBoundingClientRect();
      if(p.querySelectorAll('a[href*="/qiye/"]').length===1
         && p.querySelectorAll('a[href*="/zhaogong/"]').length<=1
         && r.height>90 && r.height<420 && /元\\//.test(txt)){ card=p; break; }
    }
    if(!card) continue;
    const lines=(card.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean);
    const jobA=card.querySelector('a[href*="/zhaogong/"]');
    const href=jobA?jobA.getAttribute('href'):'';
    if(!href) continue;
    const txt=(card.innerText||'');
    const company=(q.innerText||'').trim().split('\\n')[0];
    // 区域 = **公司名所在行的下一行**（实测卡片行序：标题/薪资/标签…/公司/区域）。
    // 不要用正则去猜：实测 60 条里有 24 条区域只写裸「苏州」，不带「·XX区」，
    // 用「XX·XX区|XX市」匹配会漏掉 40%，而 cityOk() 靠这个字段判苏州 —— 漏了会被整批误杀。
    let loc='';
    const ci=lines.indexOf(company);
    if(ci>=0 && ci+1<lines.length) loc=lines[ci+1];
    else {
      // 兜底：公司名不在行序里（偶发），取最后一个非标签行
      for(let i=lines.length-1;i>=0;i--){
        const s=lines[i];
        if(s!==company && !/元\\//.test(s) && !/^[0-9]/.test(s) && s.length<=12){ loc=s; break; }
      }
    }
    out.push({
      href,
      title:(lines[0]||'').trim(),
      salRaw:(lines[1]||'').trim(),
      company,
      loc,
      txt:txt.replace(/\\n+/g,' | ').slice(0,220)
    });
  }
  return JSON.stringify(out);
})()`;

const COUNT = `document.querySelectorAll('a[href*="/qiye/"]').length`;

/** 单关键词：导航 → 滚动懒加载 → 扫卡片（鱼泡无翻页，池子靠滚动扩） */
export async function scanKeyword(cdp, keyword, { rounds = 8, settle = 2600 } = {}) {
  await navigate(cdp, searchUrl(keyword), { settle: 4500 });
  const g = await guard(cdp);
  if (!g || g.slider || g.waf || g.loginPage) return { items: [], stopped: g || { reason: 'probe_failed' } };

  let last = 0, stable = 0;
  for (let i = 0; i < rounds; i++) {
    const n = await evalJs(cdp, COUNT, 12000);
    if (n === last) { stable++; if (stable >= 2) break; } else stable = 0;
    last = n;
    await evalJs(cdp, 'window.scrollTo(0, document.body.scrollHeight); "ok"', 12000);
    await sleep(settle);
    const g2 = await guard(cdp);
    if (g2 && (g2.slider || g2.waf || g2.loginPage)) return { items: [], stopped: g2 };
  }

  const items = (await evalJson(cdp, SCAN_CARDS, 25000)) || [];
  if (!items.length) {
    return { items: [], stopped: null, diagnostic: { reason: 'no_cards', head: await evalJs(cdp, '(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,200)') } };
  }
  return { items, stopped: null };
}

/**
 * 薪资归一化 —— **本适配器必须做的核心工作**。
 *
 * 鱼泡详情页/列表混用 4 种写法，其中 `8千-1.2万/月` 这类 core/salary.mjs
 * 完全解析不出（实测 minK=maxK=0），会让所有高薪岗被 25K 阈值误杀。
 * 这里把区间两端各自换算成「元/月」再交给 core 复算。
 */
export function normSalary(raw) {
  const s = String(raw || '').replace(/\s+/g, '');
  if (!s) return { sal: '', capK: 0 };
  const range = s.match(/^([\d.]+)(万|w|千|k|K)?\s*-\s*([\d.]+)(万|w|千|k|K)?/);
  const unit = (n, u) => {
    const v = parseFloat(n);
    if (Number.isNaN(v)) return 0;
    switch (u) { case '万': case 'w': return v * 10000; case '千': return v * 1000; case 'k': case 'K': return v * 1000; default: return v; }
  };
  // 「元/天」「元/小时」不是月薪，直接返回 0 让其在阈值处被淘汰
  if (/元\/(天|日|小时|时)/.test(s)) return { sal: s, capK: 0 };
  if (range) {
    // 鱼泡常只在一端带单位（`1-1.2万`、`2-3.5万`），另一端必须继承 —— 否则 `1-1.2万`
    // 会被当成 `1元-1.2万`，上限算成 0.12K 而被 25K 阈值误杀。
    const u1 = range[2] || range[4];
    const u2 = range[4] || range[2];
    const lo = unit(range[1], u1);
    const hi = unit(range[3], u2);
    if (lo > 0 && hi > 0) {
      const min = Math.round(Math.min(lo, hi));
      const max = Math.round(Math.max(lo, hi));
      const canon = `${min}-${max}元/月`;
      return { sal: canon, capK: parseSalary(canon).maxK };
    }
  }
  return { sal: s, capK: parseSalary(s).maxK };
}

/** href 是站内相对路径，必须补成绝对地址，否则 Page.navigate 报 invalid URL */
export function resolveUrl(item) {
  const u = item.url || item.href || '';
  if (!u) return '';
  return u.startsWith('/') ? SITE + u : u;
}

/**
 * 岗位 ID：取 URL 里的**数字ID**（`/zhaogong/486969794/<token>.html`）。
 * token 是每次请求都会变的随机串，绝不能进去重键 —— 与导出的 ID_RE 保持同一口径。
 */
export function jobIdOf(href) {
  const m = String(href || '').match(ID_RE);
  return m ? m[1] : null;
}

export function normalize(items) {
  return items
    .filter((j) => j.title && jobIdOf(j.href))
    .map((j) => {
      const n = normSalary(j.salRaw || j.sal);
      const loc = normalizeLoc(j.loc);
      return {
        ...j,
        id: jobIdOf(j.href),
        sal: n.sal,
        salRaw: j.salRaw || j.sal || '',
        capK: n.capK,
        loc,                                   // 供 targets/汇报展示
        city: loc ? '苏州' : '',               // 供 cityOk() 判定（见函数注释）
        url: resolveUrl(j),
      };
    });
}

/**
 * 城市字段归一化。
 *
 * 搜索 URL 已锁定 `/topic/a221/`（a221 = 苏州），返回的每一条都是苏州的岗，
 * 无需再按地名过滤。但 `criteria.cityOk()` 默认只认字符串里的「苏州」二字，
 * 而鱼泡的 loc 有三种写法：`苏州·吴中区` / `苏州·昆山市` / 裸 `苏州` ——
 * 前两种含「苏州」没问题，**裸「苏州」以外的苏州下辖区**（`昆山市`/`常熟市`/`太仓市`）
 * 会被误判成「非苏州」而整批丢掉。
 *
 * 因此这里把下辖市/区统一补出「苏州」前缀，让 cityOk() 判得对。
 */
export function normalizeLoc(loc) {
  const s = String(loc || '').trim();
  if (!s) return '';
  if (s.indexOf('苏州') >= 0) return s;
  // 苏州下辖县级市/区（实测列表会出现裸写法）
  const SUB = /^(昆山市?|常熟市?|张家港市?|太仓市?|吴中区?|虎丘区?|相城区?|姑苏区?|吴江区?|平江区?|沧浪区?|金阊区?|高新区?|工业园区?|吴中区?)$/;
  const bare = s.split('·').pop().trim();
  return SUB.test(bare) ? `苏州·${bare}` : s;
}

// ---------------------------------------------------------------- JD

/**
 * 读 JD。
 * 详情页正文在「职位总结」标题下的容器里（实测 class agbe，但已混淆，别信）。
 * **不能读整页** —— 页脚「职位大全/相关搜索/虎丘区C#招聘」会把关键词全命中，
 * 导致每个岗位看起来都像 .NET（与智联踩过的坑同类）。
 */
export async function readJd(cdp) {
  const d = await evalJson(cdp, `(function(){
    const HEADS=['职位总结','职位详情','岗位职责','工作内容','任职要求','岗位要求','职位描述'];
    let scope=null;
    for(const h of HEADS){
      const n=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&(e.innerText||'').trim()===h);
      if(!n) continue;
      let p=n.parentElement;
      for(let i=0;i<5&&p;i++,p=p.parentElement){
        const len=(p.innerText||'').length;
        if(len>100&&len<6000){ scope=p; break; }
      }
      if(scope) break;
    }
    if(!scope) scope=document.body;
    const t=(scope.innerText||'').replace(/\\n{2,}/g,'\\n');
    const h1=document.querySelector('h1');
    return JSON.stringify({
      title:h1?(h1.innerText||'').trim():'',
      body:t.slice(0,6000),
      scoped: scope!==document.body,
      bodyLen: document.body?document.body.innerText.length:0
    });
  })()`, 25000);
  if (!d) return null;
  return {
    jdTitle: d.title,
    flags: techFlags(d.body),
    ageLimit: detectAgeLimit(d.body),
    body: d.body,
    scoped: d.scoped,
    pageLen: d.bodyLen,
  };
}

// ---------------------------------------------------------------- 投递

/**
 * 投递区按钮。
 *
 * ⚠️ 实测坑：详情页有 **两个**「发送简历」 —— 主投递区一个，`相同职位推荐` 区还有一个，
 *    后者 y=-1382（在视口上方外，getBoundingClientRect().top 为负）。
 *    无差别取 els[0] 虽碰巧命中主按钮，但一旦主区未渲染就会误点推荐位。
 *    因此统一加 `inView + hitSelf` 双条件：必须落在视口内，且 elementFromPoint 命中自己。
 *
 * 未登录时三者（发送简历 / 聊一聊 / 查看详情）都会退化为
 * `点击登录，立即与老板沟通` —— 这是最可靠的登录态判据。
 */
const APPLY_BTN = `(function(){
  const kw=/^(发送简历|立即投递|投递简历|聊一聊|立即沟通|继续沟通|已投递|已沟通|申请职位)$/;
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect();
    if(!kw.test(t) || r.width<=50 || r.height<22 || r.width>=340) return false;
    if(r.top<0 || r.bottom>document.documentElement.clientHeight) return false;   // 视口外（推荐位）
    const cx=Math.round(r.x+r.width/2), cy=Math.round(r.y+r.height/2);
    const hit=document.elementFromPoint(cx,cy);
    return !!hit && (hit===e || e.contains(hit) || hit.contains(e));           // 未被遮挡
  });
  const done=els.find(e=>/已投递|已沟通|继续沟通/.test(e.textContent||''));
  if(done) return JSON.stringify({state:'done', text:done.textContent.trim()});
  const ready=els.find(e=>/发送简历|立即投递|投递简历|申请职位/.test(e.textContent||''));
  if(ready){ const r=ready.getBoundingClientRect();
    return JSON.stringify({state:'ready', text:ready.textContent.trim(), tag:ready.tagName,
      x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}); }
  // 无按钮但标题区写「已招满」→ 岗位已关闭投递，必须与「按钮没渲染出来」区分开，
  // 否则 applyOne 会把这种岗一直当 no_btn 重投（实测鱼泡招满后会撤掉按钮只留标题提示）。
  const head=(document.body?document.body.innerText:'').slice(0,400);
  if(/已招满/.test(head)) return JSON.stringify({state:'closed', text:'已招满'});
  const t=document.body?document.body.innerText:'';
  if(/点击登录[，,]?\\s*立即与老板沟通/.test(t)) return JSON.stringify({state:'login'});
  return null;
})()`;

/**
 * JS click。
 * 按钮本体是 SPAN（无 onClick），靠 React 在 root 上的事件委托冒泡生效 ——
 * 所以直接对 span 调 .click() 是有效的；但为兼容万一改成 button/a 的版本，
 * 命中后优先向上找到最近的 button/a 再点。
 */
const CLICK_SEND = `(function(){
  const kw=/^(发送简历|立即投递|投递简历|申请职位)$/;
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect();
    if(!kw.test(t) || r.width<=50 || r.height<22 || r.width>=340) return false;
    if(r.top<0 || r.bottom>document.documentElement.clientHeight) return false;
    const cx=Math.round(r.x+r.width/2), cy=Math.round(r.y+r.height/2);
    const hit=document.elementFromPoint(cx,cy);
    return !!hit && (hit===e || e.contains(hit) || hit.contains(e));
  });
  if(!els.length) return 'nf';
  const e=els[0];
  const target=(e.tagName==='BUTTON'||e.tagName==='A') ? e
    : (e.closest('button') || e.closest('a') || e);
  target.click();
  return 'clicked';
})()`;

/**
 * 投递单个岗位。
 *
 * 点击方式：**先 JS click，未生效再真实鼠标兜底**。
 * 鱼泡未登录探测时无法确定哪种生效（未登录点不到真按钮），
 * 故两条路都留，且每一步都用按钮文案复核，不盲信「点了就是成功」。
 */
export async function applyOne(cdp, item) {
  await navigate(cdp, resolveUrl(item), { settle: 3500 });

  // 导航后**先查风控**，再看按钮 —— 被滑块拦住时页面上根本没有按钮，
  // 不先判就会误报 `no_btn`（实测：连着访问详情页 ~5 次即触发滑块）。
  const g0 = await guard(cdp);
  if (g0 && g0.slider) return { result: 'slider_blocked', guard: g0 };
  if (g0 && g0.waf) return { result: 'waf_blocked' };
  if (g0 && g0.notFound) return { result: 'not_found' };

  const before = await evalJson(cdp, APPLY_BTN, 15000);
  if (!before) return { result: 'no_btn' };
  if (before.state === 'done') return { result: 'already' };
  if (before.state === 'closed') return { result: 'closed' };   // 已招满，投递入口已被撤掉
  if (before.state === 'login') return { result: 'login_wall' };
  if (before.state !== 'ready') return { result: 'unexpected_state', btn: before.text };

  // 路径 1：JS click
  const r = await evalJs(cdp, CLICK_SEND, 15000);
  if (r !== 'clicked') return { result: 'js_fail' };
  await sleep(rand(2200, 3200));

  let after = await evalJson(cdp, APPLY_BTN, 15000);
  if (after && after.state === 'done') return { result: 'ok', via: 'js' };

  // 路径 2：真实鼠标（51job 已证明存在平台只认真实点击）
  if (after && after.state === 'ready') {
    await clickAt(cdp, after.x, after.y);
    await sleep(rand(2200, 3200));
    after = await evalJson(cdp, APPLY_BTN, 15000);
    if (after && after.state === 'done') return { result: 'ok', via: 'mouse' };
    if (after && after.state === 'login') return { result: 'login_wall' };
  }

  const g = await guard(cdp);
  if (g && g.slider) return { result: 'slider_blocked' };
  if (g && g.waf) return { result: 'waf_blocked' };
  if (g && g.loginWall) return { result: 'login_wall' };
  return { result: 'unknown', btn: after ? `${after.state}:${after.text || ''}` : null };
}

/** 只读巡检：读按钮状态，不点击 */
export async function probeItem(cdp, item) {
  await navigate(cdp, resolveUrl(item), { settle: 3000 });
  const g = await guard(cdp);
  // 风控时直接把状态带出去，不要让调用方把 slider 误读成「按钮 null = 没投」
  if (g && (g.slider || g.waf || g.notFound)) {
    return {
      title: item.title,
      company: item.company,
      btn: g.notFound ? 'not_found' : (g.waf ? 'waf' : 'slider_blocked'),
      waf: !!g.waf,
    };
  }
  const btn = await evalJson(cdp, APPLY_BTN, 15000);
  return {
    title: item.title,
    company: item.company,
    btn: btn ? `${btn.state}:${btn.text || ''}` : 'no_btn',
    waf: g ? !!g.waf : null,
  };
}

// ---------------------------------------------------------------- 沟通

/**
 * PC 网页版是否有可用的消息中心**尚未验证** —— 需登录态下打开「聊一聊」观察。
 * 在未验证前不臆造选择器，直接声明不支持，让 chat 命令跳过。
 * 恢复方式：登录后跑一次探测，把下面的 selectors 换成实测值并置 chatSupported = true。
 */
export const chatSupported = false;

export const notes = [
  '站点有阿里云 WAF（acw_sc__v2）+ 滑块验证；curl 只能拿到 4.8KB 挑战页，必须走真实浏览器',
  '详情页连着访问约 5 次即触发滑块（正文文案「访问验证 / 请按住滑块，拖动到最右边」，标题「滑动验证页面」）；命中即停，约几分钟自行过期',
  'class 名每次构建都重新混淆（实测 acccc/accch/ahea/agbe…），本适配器一律语义定位',
  '卡片锚点是公司链接 /qiye/<id>.html，每卡恰好一个；靠它向上找整卡（从详情链接找会切半张卡）',
  '详情页 URL 为 /zhaogong/{数字ID}/{token}.html，token 每次变，去重只能用数字ID',
  '列表纯滚动懒加载，无翻页按钮；6 次滚动实测 16→105 条',
  '详情页薪资写作「8千-1.2万/月」，core/salary.mjs 解析为 0，必须由 normalize() 归一化（且单位只在一端时要继承）',
  '卡片区域 = 公司名的下一行；实测 40% 只写裸「苏州」，用正则猜地名会漏，进而被 cityOk() 整批误杀',
  '未登录时投递区退化为「点击登录，立即与老板沟通」；登录判据看右上角「登录丨注册」是否消失',
  '详情页有两个「发送简历」（主区 + 相同职位推荐区），已加视口内+未遮挡过滤，防误点推荐位',
  '投递按钮本体是 SPAN（无 onClick），靠 React root 事件委托 → JS click 有效，真实鼠标留作兜底',
  '岗位招满会撤掉投递按钮并显示「已招满」→ result = closed，不进重投名单',
  'URL 里的 token 过期会跳「页面找不到啦」→ result = not_found',
  'PC 端消息中心能力未验证，chatSupported = false，登录后再补适配',
];
