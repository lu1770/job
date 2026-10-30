/**
 * 筛选口径：屏蔽名单 + 标题相关性 + JD 技术栈 + 年龄限制。
 * 规则表放在 config/criteria.json，可直接改配置而不动代码。
 */
import { readConfig } from './io.mjs';

// ---------------------------------------------------------------- 屏蔽名单

export function blocklist() {
  return (readConfig('blocklist.json', { companies: [] }).companies || []).filter(Boolean);
}

export function blockedCompany(name, list = blocklist()) {
  const s = String(name || '');
  if (!s) return null;
  return list.find((c) => s.includes(c) || c.includes(s)) || null;
}

// ---------------------------------------------------------------- 规则表

const DEFAULT_CRITERIA = {
  // 明确排除的技术方向 / 岗位性质（大小写不敏感）
  exclude: [
    'c\\+\\+|cpp|\\bqt\\b|qt5|java|labview|python|golang|php|前端|android|ios|vue|react',
    '算法|视觉|图像|slam|大模型|机器学习|人工智能|具身|机器人',
    '硬件|fpga|dsp|pcb|射频|天线|电路|电气|plc|伺服|变频|电机|电控|编码器|机械|结构|工艺|制程',
    '嵌入式|固件|单片机|底层|驱动|内核|autosar|mcu|bios|bsp|\\barm\\b|rtos|\\bsoc\\b|\\bsdk\\b|\\bbms\\b|逆变|储能|电源|雷达|感知|智驾|自动驾驶|adas|编译器|llvm|gpu|vulkan|cuda|eda|数控',
    '测试|运维|技术支持|实施|售前|售后|\\bfae\\b|解决方案|顾问|业务分析',
    '销售|商务|采购|供应链|市场|客户|渠道|总监|总经理|部长|厂长|人力资源|教务',
    '产品经理|项目经理|pmo|咨询|运营|仓储|物流|生产|质量|计划员|主管|负责人|经理',
    '架构师(?!.*软件)',
  ],
  // JD 正文技术栈屏蔽：命中 techFlags 中这些标记即剔除（标题看不出来的方向在这里兜底）
  excludeJdFlags: ['java', 'labview'],
  // 必须命中（.NET / 上位机主线）—— 仅用于分档标记，不做硬性拦截（硬拦截看 JD 实证）
  strong: ['上位机', 'c#', '\\.net', 'net开发', 'wpf', 'winform', 'mes', 'eap', 'secs', '工控软件'],
  // 开发主线关键词：JD 核验前的粗筛，避免把详情页访问浪费在明显非开发岗上
  require: ['软件工程师', '软件开发', '开发工程师', '上位机', '程序员', '软件研发', 'c#', '\\.net', 'net开发', 'wpf', 'winform', 'mes', 'eap', 'secs', '工控软件', '嵌入式?软件(?!开发)'],
  // 粗筛阶段直接丢弃（非开发岗），避免无谓的详情页访问
  coarseDrop: ['测试|运维|实施|售后|售前|销售|商务|采购|供应链|市场|人事|行政|财务|法务|司机|保安|普工|操作工', '总监|总经理|部长|厂长|合伙人|人事|主管'],
};

let _cache = null;
export function criteria() {
  if (!_cache) {
    const c = readConfig('criteria.json', {});
    _cache = {
      exclude: (c.exclude || DEFAULT_CRITERIA.exclude).map((s) => new RegExp(s, 'i')),
      excludeJdFlags: c.excludeJdFlags || DEFAULT_CRITERIA.excludeJdFlags,
      strong: (c.strong || DEFAULT_CRITERIA.strong).map((s) => new RegExp(s, 'i')),
      require: (c.require || DEFAULT_CRITERIA.require).map((s) => new RegExp(s, 'i')),
      coarseDrop: (c.coarseDrop || DEFAULT_CRITERIA.coarseDrop).map((s) => new RegExp(s, 'i')),
      capKMin: c.capKMin ?? 25,
      requireDotNetInJd: c.requireDotNetInJd ?? true,
    };
  }
  return _cache;
}

// ---------------------------------------------------------------- 判定

/** 标题层面的排除判定（大小写不敏感） */
export function screenTitle(title) {
  const t = String(title || '').trim();
  for (const re of criteria().exclude) if (re.test(t)) return { ok: false, why: `标题排除:${re.source}` };
  return { ok: true };
}

/** JD 正文技术栈屏蔽（依据 techFlags 标记 + excludeJdFlags 配置） */
export function screenJdFlags(flags = {}) {
  const hit = criteria().excludeJdFlags.find((k) => flags && flags[k]);
  return hit ? { ok: false, why: `JD排除:${hit}` } : { ok: true };
}

/** A 档 = 标题直接命中 .NET / 上位机强信号 */
export function tierOf(title) {
  const t = String(title || '');
  return criteria().strong.some((re) => re.test(t)) ? 'A' : 'B';
}

/** 粗筛：明显非开发岗直接丢（省详情页访问） */
export function coarseScreen(title) {
  const t = String(title || '');
  for (const re of criteria().coarseDrop) if (re.test(t)) return { ok: false, why: `粗筛丢弃:${re.source}` };
  return { ok: true };
}

/** 粗筛：必须是开发主线关键词 */
export function requireScreen(title) {
  const t = String(title || '');
  return criteria().require.some((re) => re.test(t));
}

import { cityRegex, DEFAULT_CITY, resolveCity } from './city.mjs';

/** 城市口径（各平台字段名不同，统一在这里判） */
export function cityOk(item, city = DEFAULT_CITY) {
  const s = String(item.loc || item.city || item.area || item.company || item.txt || '');
  // 城市字段为空时：如果搜索 URL 是按目标城市锁死的（全部平台都是），
  // 这条就是目标城市的岗，放它过去；只在 URL 城市参数被外部篡改时才会误漏。
  if (!s) return true;
  return cityRegex(city).test(s);
}

/**
 * JD 技术栈判定（正文字符串 → 布尔标记）。BOSS 与猎聘共用同一套规则。
 */
export function techFlags(body = '') {
  const b = body.toLowerCase();
  return {
    dotnet: /c#|\.net|asp\.net|winform|wpf|wpf|net core/.test(b),
    wpf: /wpf/.test(b),
    upper: /上位机/.test(body),
    motion: /运动控制/.test(body),
    mes: /\bmes\b|\beap\b|secs|gems/.test(b),
    cpp: /c\+\+/.test(body),
    java: /java/.test(b),
    labview: /labview/.test(b),
    qt: /qt5|qtcreator|\bqt\b/.test(b),
    algo: /算法工程师|算法开发|视觉|图像处理|slam/.test(body),
    embed: /嵌入式|固件|单片机|dsp|fpga/.test(b),
    hw: /硬件设计|pcb|电路设计|原理图/.test(body),
    sales: /销售|客户开发|商务拓展/.test(body),
    mgr: /部门管理|团队管理|人员管理/.test(body),
    plague: /外包|外派|驻场|人力外包|底薪\+提成|计件/.test(body),
  };
}

export { detectAgeLimit } from './age.mjs';