/**
 * 鱼泡投递判据链的**纯逻辑**单测（不碰浏览器）。
 *
 * 做法：把 yupaopin.mjs 里的 APPLY_BTN / CLICK_SEND 页面表达式提取出来，
 * 在 Node 里喂进模拟的 DOM 元素，验证状态判定是否符合实测规则。
 * 这能在没有 CDP 的情况下锁住判据逻辑，防止以后改坏。
 *
 * 用法：node scripts/test_yupaopin_btns.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/platforms/yupaopin.mjs'), 'utf8');

/** 从源码里抠出 const NAME = `...`; 的模板字符串 */
function extract(name) {
  const m = SRC.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  if (!m) throw new Error('未找到表达式: ' + name);
  // 还原模板里的 \\n \\s 等（源码里是双写，页面里是单写）
  return m[1].replace(/\\\\/g, '\\');
}

const APPLY_BTN_SRC = extract('APPLY_BTN');

// ---------------------------------------------------------------- 模拟 DOM

let VIEWPORT_H = 1500;

let SEQ = 0;

/** 造一个元素；cover 表示该点被谁遮挡（null = 无人遮挡） */
function mk(text, { tag = 'SPAN', top = 100, w = 120, h = 40, cover = undefined } = {}) {
  const x = 10 + (SEQ++) * 200;          // 每个元素横向错开，避免中心点撞车
  const rect = { x, y: top, width: w, height: h, top, bottom: top + h };
  const self = { textContent: text, tagName: tag, getBoundingClientRect: () => rect };
  self.contains = (n) => n === self;
  let cov = cover;
  if (cover === undefined) cov = self;
  else if (cover !== null && typeof cover.contains !== 'function') {
    cov = { ...cover, contains: (n) => n === cover };
  }
  return { el: self, rect, cover: cov };
}

function run(buttons, { bodyText = '' } = {}) {
  SEQ = 0;
  // 先按传入顺序重排 x（mk 时用的旧 SEQ 不作数）
  const byPoint = new Map();
  buttons.forEach((b, i) => {
    const x = 10 + i * 200;
    const rect = { x, y: b.rect.y, width: b.rect.width, height: b.rect.height, top: b.rect.top, bottom: b.rect.bottom };
    b.el.getBoundingClientRect = () => rect;
    byPoint.set(`${Math.round(x + rect.width / 2)},${Math.round(rect.y + rect.height / 2)}`, b.cover);
  });

  const doc = {
    documentElement: { clientHeight: VIEWPORT_H },
    body: { innerText: bodyText },
    querySelectorAll: () => buttons.map((b) => b.el),
    elementFromPoint: (x, y) => {
      const v = byPoint.get(`${Math.round(x)},${Math.round(y)}`);
      return v === undefined ? null : v;
    },
  };
  const body = APPLY_BTN_SRC
    .replace(/^\(function\(\)\{/, '')
    .replace(/\}\)\(\)\s*;?\s*$/, '');
  const raw = new Function('document', `return (function(){${body}})();`)(doc);
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------- 用例

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = got ? (got.state === 'done' ? `done:${got.text}` : got.state) : 'null';
  const w = want;
  const ok = g === w || (w === 'done' && String(g).startsWith('done'));
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(34)} 实测=${String(g).padEnd(22)} 期望=${w}`);
  ok ? pass++ : fail++;
}

// 1. 未投递：发送简历 + 免费聊 → ready
check('未投递(发送简历+免费聊)', run([
  mk('发送简历'), mk('免费聊'),
]), 'ready');

// 2. 已投递：继续聊 + 拨打电话 → done（早期 bug：漏了「继续聊」判成 no_btn）
check('已投递(继续聊+拨打电话)', run([
  mk('继续聊'), mk('拨打电话'),
]), 'done');

// 3. 只有沟通按钮 → chat_only
check('只有免费聊(不收简历)', run([mk('免费聊')]), 'chat_only');

// 4. 视口外的「发送简历」（推荐位）必须被忽略
check('推荐位按钮(视口外)', run([mk('发送简历', { top: -1400 })]), 'null');

// 5. 被遮挡的按钮不算数
check('按钮被遮挡', run([mk('发送简历', { cover: { tagName: 'DIV' } })]), 'null');

// 6. 尺寸不符（太窄/太宽）不算
check('按钮太窄', run([mk('发送简历', { w: 40 })]), 'null');
check('按钮太宽', run([mk('发送简历', { w: 400 })]), 'null');

// 7. 两套文案并存时「已投递优先」
check('两套并存(已投递优先)', run([
  mk('发送简历'), mk('继续聊'),
]), 'done');

// 8. 无按钮但标题区「已招满」→ closed（业务终态，不是 no_btn）
check('已招满(无按钮)', run([], { bodyText: '首页 职位 公司 路正遥 已招满 软件工程师 1.5-2.5万/月 更多职位招聘' }), 'closed');

// 9. 未登录：投递区退化为「点击登录，立即与老板沟通」
check('未登录', run([], { bodyText: '首页 职位 公司 登录丨注册 点击登录，立即与老板沟通 职位详情' }), 'login');

// 10. 什么都没匹配 → null（真·no_btn，调用方会重投）
check('真无按钮', run([], { bodyText: '首页 职位 公司 职位详情 微信扫码分享' }), 'null');

// 11. 视口下边界：按钮贴着视口底部之外应被排除
check('底部越界', run([mk('发送简历', { top: VIEWPORT_H - 10, h: 40 })]), 'null');

// 12. 点击按钮本体是 SPAN，坐标必须落在视口内且可命中（防止算出 NaN 坐标）
const r = run([mk('发送简历', { top: 100 })]);
console.log(`${r && r.state === 'ready' && Number.isFinite(r.x) && Number.isFinite(r.y) ? '✅' : '❌'} 坐标可计算${' '.repeat(25)}实测=${JSON.stringify({ x: r && r.x, y: r && r.y })}`);
(r && Number.isFinite(r.x) && Number.isFinite(r.y)) ? pass++ : fail++;

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
