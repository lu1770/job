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
 *  - 详情页 URL：`/zhaogong/{数字ID}/{token}.html`。**token 每次都变且有时效**（隔天再访会 404，
 *    标题「哎呀,页面找不到啦」），数字ID 才是稳定岗位ID；`recoverUrl()` 负责用 ID 换新 token。
 *  - 列表是**纯滚动懒加载**，实测无翻页按钮：16 → 31 → 46 → 61 → 76 → 90 → 105（6 次滚动）。
 *  - **投递区是两套文案成对出现**（这是本适配器最容易写错的地方）：
 *      未投递 = `发送简历` + `免费聊`      已投递 = `继续聊` + `拨打电话`
 *    漏掉「继续聊」会把「早已投递」误报成 `no_btn`（实战 46 条里错判 3 条）。
 *  - 投递按钮本体是 SPAN（无 onClick），靠 React root 事件委托 → **JS click 有效**（已实测 `via: js`）。
 *    页面还有第二个「发送简历」在「相同职位推荐」区、位于视口外 y=-1382 → 必须加视口内+未遮挡过滤。
 *  - 投递后按钮变「继续聊」要 3~8s，固定等 2.2s 回读会误判 unknown（实战 5 条 unknown 里 2 条其实已成功）。
 *  - 详情页薪资写作 `8千-1.2万/月`，core/salary.mjs 解析为 0 → 必须由 normalize() 归一化。
 *  - 登录态：右上角「登录丨注册」= 游客；「消息 / 简历 / 路正遥」= 已登录（实测本机已登录）。
 *  - 岗位招满后标题区显示「**已招满**」并**撤掉投递按钮** → `closed`（业务终态，不重投）。
 *  - 详情页连访约 5 次触发阿里云滑块 → `slider_blocked`（约几分钟自行过期）。
 *
 * 判据链有纯逻辑单测覆盖：`node scripts/test_yupaopin_btns.mjs`（13 例，不依赖浏览器）。
 */
import { evalJson, evalJs, sleep, clickAt, navigate, rand } from '../core/cdp.mjs';
import { withFlags } from '../core/readjd.mjs';
import { multiScan } from '../core/multiscan.mjs';
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

/** 标签页归属特征：session() 靠它认领「本平台自己的」标签（见 core/session.mjs） */
export const HOST = 'yupao.com';

export function searchUrl(keyword) {
  return `${SITE}/topic/${CITY_CODE}${CAT_ALL}/?keywords=${encodeURIComponent(keyword)}`;
}

export const homeUrl = `${SITE}/${CITY_CODE}/`;

/** 登录入口页（APP / 微信扫码登录）。login 检测到未登录时会新开标签卡打开它。 */
export const loginUrl = `${SITE}/web/login/`;

// ---------------------------------------------------------------- 登录 / 风控

/**
 * 登录态核验。
 *
 * 判据用右上角的 **「登录丨注册」→ 登录后变成「消息 / 简历 / <用户名>」**。
 * 已实测本机 Profile 1 为登录态，页面显示 `路正遥`。
 *
 * ⚠️ 必须轮询重试，不能只探一次：
 *    浏览器刚启动（或新开标签页）时鱼泡 Cookie 还没注入，页面会短暂呈现游客态 ——
 *    实测 `login` 在 Chrome 冷启动后第一次报「未登录」，紧接着第二次就正常。
 *    单次探测产生**假阴性**，而 `daily` 会因 `ok=false` 直接跳过整个平台（白跑一轮）。
 *    故这里重试到判据成立为止；确实被风控拦（waf）则立即返回，不空转。
 */
export async function loginProbe(cdp, { tries = 3, gap = 2500 } = {}) {
  await navigate(cdp, searchUrl('.NET'), { settle: 5000 });
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await evalJson(cdp, `(function(){
      const t=(document.body?document.body.innerText:'');
      const head=t.replace(/\\s+/g,' ').slice(0,1500);
      // 未登录：右上角为「登录丨注册」；登录后：出现「消息」「简历」与用户名
      const guest=/登录\\s*[丨|]\\s*注册/.test(head);
      const name=(head.match(/(路正遥)/)||[])[1] || '';
      const hasNav=/消息/.test(head) && /简历/.test(head);
      // 本函数只判登录态，风控交给 guard()（判据要保持一致，不要各写一套）
      return JSON.stringify({
        ok: !guest && hasNav,
        name, guest, hasNav, waf:false,
        cards: document.querySelectorAll('a[href*="/qiye/"]').length,
        head: head.slice(0,80)
      });
    })()`, 20000);
    if (last && last.ok) return last;
    if (i < tries - 1) await sleep(gap);
  }
  return last;
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

/** 单轮：导航 → 滚动懒加载 → 扫卡片（鱼泡无翻页，池子靠滚动扩） */
async function scanOnce(cdp, keyword, { rounds = 8, settle = 2600 } = {}) {
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
  const diagnostic = items.length ? null : { reason: 'no_cards', head: await evalJs(cdp, '(document.body?document.body.innerText:"").replace(/\\s+/g," ").slice(0,200)') };
  return { items, stopped: null, diagnostic };
}

/** 单关键词采集：刷新 N 次合并去重（默认 1 = 关闭；href 里 token 每次刷新都变，只有数字段稳定） */
export async function scanKeyword(cdp, keyword, { rounds = 8, settle = 2600, refresh = 1 } = {}) {
  return multiScan((r) => scanOnce(cdp, keyword, { rounds, settle }), {
    refresh,
    keyOf: (j) => jobIdOf(j.href) || j.href || '',
    pauseMs: 3500,
  });
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

/** 搜索/热门职位页：用于按岗位 ID 反查最新 token（见 recoverUrl） */
const LIST_URLS = [
  `${SITE}/topic/${CITY_CODE}${CAT_ALL}/?keywords=C%23`,
  `${SITE}/zhaogong/${CITY_CODE}_rmgz/`,
  `${SITE}/${CITY_CODE}/`,
];

/**
 * token 失效兜底：鱼泡详情页 URL 里的 token **有时效**（实测隔天再访同一条 url 会跳
 * 「哎呀,页面找不到啦」）。清单是几天前采的，直接拿去 apply 会整批 404 → not_found。
 *
 * 用岗位数字 ID 回到列表页重新捞一条带最新 token 的链接。
 * 只在详情页返回 not_found 时调用，正常路径不花这个开销。
 *
 * @returns {Promise<string|null>} 新 URL；捞不到返回 null
 */
export async function recoverUrl(cdp, item, { tries = 3 } = {}) {
  const id = String(item.id || jobIdOf(item.url || item.href) || '');
  if (!id) return null;
  for (let k = 0; k < Math.min(tries, LIST_URLS.length); k++) {
    await navigate(cdp, LIST_URLS[k], { settle: 3500 });
    for (let s = 0; s < 3; s++) {   // 列表懒加载，滚一轮再找
      const href = await evalJson(cdp, `(function(){
        const a=[...document.querySelectorAll('a')].map(x=>x.getAttribute('href')||'');
        const m=a.find(h=>h.indexOf('/zhaogong/${id}/')>=0);
        return m? JSON.stringify(m) : null;
      })()`, 20000);
      if (href) return href.startsWith('/') ? SITE + href : href;
      await evalJs(cdp, 'window.scrollTo(0, document.body.scrollHeight); "ok"', 12000);
      await sleep(2200);
    }
  }
  return null;
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
  return withFlags(d);
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
 *
 * ⚠️ 实测坑（2026-10-13，投送时批量踩中）：投递区是**两个按钮成对出现**，
 *    且已投递 / 未投递是两套不同文案，漏掉任一套都会把「已投过」误报成 `no_btn`：
 *
 *      未投递：`发送简历` + `免费聊`
 *      已投递：`继续聊`   + `拨打电话`   ← 早期版本漏了「继续聊」，46 条里 3 条误判
 *
 *    判据必须是「**已投递文案优先**」：先找 `继续聊/已投递/…` 再找 `发送简历`，
 *    否则同一个岗位里两种文案并存时会被当成可投递。
 */
const APPLY_BTN = `(function(){
  const READY=/^(发送简历|立即投递|投递简历|申请职位)$/;
  const DONE=/^(继续聊|已投递|已沟通|已沟通过|继续沟通)$/;
  const CHAT=/^(免费聊|拨打电话)$/;
  const els=[...document.querySelectorAll('button,a,div,span')].filter(e=>{
    const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect();
    if(!(READY.test(t)||DONE.test(t)||CHAT.test(t))) return false;
    if(r.width<=50 || r.height<22 || r.width>=340) return false;
    if(r.top<0 || r.bottom>document.documentElement.clientHeight) return false;   // 视口外（推荐位）
    const cx=Math.round(r.x+r.width/2), cy=Math.round(r.y+r.height/2);
    const hit=document.elementFromPoint(cx,cy);
    return !!hit && (hit===e || e.contains(hit) || hit.contains(e));           // 未被遮挡
  });
  const txt=e=>(e.textContent||'').trim();
  // 已投递文案优先（必须是第一判据 —— 见文件头「两套文案」说明）
  const done=els.find(e=>DONE.test(txt(e)));
  if(done) return JSON.stringify({state:'done', text:txt(done)});
  // 「发送简历」才是真正的投递动作
  const ready=els.find(e=>READY.test(txt(e)));
  if(ready){ const r=ready.getBoundingClientRect();
    return JSON.stringify({state:'ready', text:txt(ready), tag:ready.tagName,
      x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}); }
  // 只有沟通类按钮、没有投递按钮：能聊但该岗不收简历投递（别拿去点「免费聊」当投递）
  const chat=els.find(e=>CHAT.test(txt(e)));
  if(chat) return JSON.stringify({state:'chat_only', text:txt(chat)});
  // 无按钮但标题区写「已招满」→ 岗位已关闭投递，必须与「按钮没渲染出来」区分开，
  // 否则 applyOne 会把这种岗一直当 no_btn 重投（实测鱼泡招满后会撤掉按钮只留标题提示）。
  const body=document.body?document.body.innerText:'';
  if(/已招满/.test(body.slice(0,400))) return JSON.stringify({state:'closed', text:'已招满'});
  if(/点击登录[，,]?\\s*立即与老板沟通/.test(body)) return JSON.stringify({state:'login'});
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
  if (g0 && g0.notFound) {
    // token 过期 → 回列表页用岗位 ID 换一条新链接再试（见 recoverUrl）
    const fresh = await recoverUrl(cdp, item);
    if (!fresh) return { result: 'not_found' };
    await navigate(cdp, fresh, { settle: 3500 });
    const g1 = await guard(cdp);
    if (g1 && g1.slider) return { result: 'slider_blocked', guard: g1 };
    if (g1 && g1.notFound) return { result: 'not_found' };
    if (g1 && (g1.loginWall || g1.loginPage)) return { result: 'login_wall', guard: g1 };
    return applyOnLoaded(cdp, fresh);
  }
  if (g0 && (g0.loginWall || g0.loginPage)) return { result: 'login_wall', guard: g0 };

  return applyOnLoaded(cdp, null);
}

/**
 * 详情页已就绪后的投递流程（applyOne 的后半段，抽出来供 token 恢复后复用）。
 * @param {string} [freshUrl] token 恢复后拿到的新 URL —— 会回填到结果里，
 *        让调用方（apply.mjs 落盘）更新清单，避免下次又拿旧 token。
 */
async function applyOnLoaded(cdp, freshUrl) {
  // 新 URL 贯穿所有返回分支
  const withUrl = (r) => (freshUrl ? { ...r, freshUrl } : r);

  const before = await evalJson(cdp, APPLY_BTN, 15000);
  if (!before) return withUrl({ result: 'no_btn' });
  if (before.state === 'done') return withUrl({ result: 'already', btn: before.text });
  if (before.state === 'closed') return withUrl({ result: 'closed', btn: before.text });   // 已招满
  // 只有沟通类按钮、没有投递按钮：能聊但该岗不收简历投递
  if (before.state === 'chat_only') return withUrl({ result: 'chat_only', btn: before.text });
  if (before.state === 'login') return withUrl({ result: 'login_wall' });
  if (before.state !== 'ready') return withUrl({ result: 'unexpected_state', btn: before.text });

  // 路径 1：JS click
  const r = await evalJs(cdp, CLICK_SEND, 15000);
  if (r !== 'clicked') return withUrl({ result: 'js_fail' });

  // 轮询复核，而不是「等 2.2s 读一次」。
  // 实测：投递后按钮变「继续聊」要 3~8s（要走接口 + 重渲染），固定 2.2s 回读会大量误判 unknown ——
  // 实测一轮 5 条 unknown，复检发现其中 2 条其实早已投递成功，只是当时没等到。
  const js = await waitBtnSettled(cdp, 'done');
  if (js && js.state === 'done') return withUrl({ result: 'ok', via: 'js' });
  if (js && js.state === 'login') return withUrl({ result: 'login_wall' });
  if (js && js.state === 'closed') return withUrl({ result: 'closed' });

  // 路径 2：真实鼠标兜底（51job 已证明存在平台只认真实点击）
  const cur = js || (await evalJson(cdp, APPLY_BTN, 15000));
  if (cur && cur.state === 'ready') {
    await clickAt(cdp, cur.x, cur.y);
    const ms = await waitBtnSettled(cdp, 'done');
    if (ms && ms.state === 'done') return withUrl({ result: 'ok', via: 'mouse' });
    if (ms && ms.state === 'login') return withUrl({ result: 'login_wall' });
    if (ms && ms.state === 'closed') return withUrl({ result: 'closed' });
  }

  const g = await guard(cdp);
  if (g && g.slider) return withUrl({ result: 'slider_blocked' });
  if (g && g.waf) return withUrl({ result: 'waf_blocked' });
  if (g && g.notFound) return withUrl({ result: 'not_found' });
  if (g && g.loginWall) return withUrl({ result: 'login_wall' });
  // 两路点击都试过仍非 done —— 明确报 unknown（未知），不猜成功也不猜失败
  return withUrl({ result: 'unknown', btn: cur ? `${cur.state}:${cur.text || ''}` : null, guard: g });
}

/**
 * 轮询等待按钮进入目标状态。
 *
 * 返回**最后一次读数**（可能为目标态，也可能是超时时的当前态），由调用方判别 ——
 * 不要用「返回值非空」当「命中」，那会把超时误当成功。
 *
 * @param {string} want 目标 state
 * @param {object} o    tries 轮数；gap 间隔 ms；first 首次等待 ms
 */
async function waitBtnSettled(cdp, want = 'done', { tries = 7, gap = 1600, first = 1300 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await sleep(i === 0 ? first : gap);
    last = await evalJson(cdp, APPLY_BTN, 15000);
    if (last && last.state === want) return last;
    // 中途被登录墙/招满拦下：立即返回让上层判，不要空转到超时
    if (last && (last.state === 'login' || last.state === 'closed')) return last;
    // 按钮整体消失且已不在详情页（如跳到聊天页）→ 投进去了，别再空转
    if (last === null) {
      const href = await evalJs(cdp, 'location.href', 8000);
      if (typeof href === 'string' && !/\/zhaogong\//.test(href)) {
        return { state: 'done', text: 'navigated', url: href };
      }
    }
  }
  return last;
}

/** 只读巡检：读按钮状态，不点击 */
export async function probeItem(cdp, item) {
  await navigate(cdp, resolveUrl(item), { settle: 3000 });
  const g = await guard(cdp);
  // 风控/未登录/token 失效时直接把状态带出去 —— 不要让调用方把 slider 误读成「按钮 null = 没投」
  if (g && (g.slider || g.waf || g.notFound || g.loginWall || g.loginPage)) {
    const state = g.notFound ? 'not_found'
      : g.waf ? 'waf_blocked'
      : (g.loginWall || g.loginPage) ? 'login_wall'
      : 'slider_blocked';
    return { title: item.title, company: item.company, btn: state, waf: !!g.waf };
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
  '详情页 URL 为 /zhaogong/{数字ID}/{token}.html，token 每次变且有时效；去重只能用数字ID',
  'token 过期会跳「页面找不到啦」→ 自动 recoverUrl() 用 ID 回列表页换新 token，捞不到才 not_found',
  '列表纯滚动懒加载，无翻页按钮；6 次滚动实测 16→105 条',
  '详情页薪资写作「8千-1.2万/月」，core/salary.mjs 解析为 0，必须由 normalize() 归一化（且单位只在一端时要继承）',
  '卡片区域 = 公司名的下一行；实测 40% 只写裸「苏州」，用正则猜地名会漏，进而被 cityOk() 整批误杀',
  '未登录时投递区退化为「点击登录，立即与老板沟通」；登录判据看右上角「登录丨注册」是否消失',
  '投递区是「发送简历+免费聊」（未投）/「继续聊+拨打电话」（已投）两套文案，判据必须已投递优先',
  '详情页有两个「发送简历」（主区 + 相同职位推荐区），已加视口内+未遮挡过滤，防误点推荐位',
  '投递按钮本体是 SPAN（无 onClick），靠 React root 事件委托 → JS click 有效（实测 via=js），真实鼠标仅作兜底',
  '投递后按钮 3~8s 才变「继续聊」，必须轮询复核；固定等 2.2s 会误判 unknown（实战 5 条里 2 条已成功）',
  '岗位招满会撤掉投递按钮并显示「已招满」→ result = closed（业务终态，不进重投名单）',
  '只有「免费聊」无「发送简历」→ result = chat_only（该岗不收简历投递，别去点免费聊当投递）',
  '判据链有纯逻辑单测：node scripts/test_yupaopin_btns.mjs（13 例，不依赖浏览器）',
  'PC 端消息中心能力未验证，chatSupported = false，登录后再补适配',
];
