/**
 * 命令：keywords —— 当日 JD 关键词排行（只读分析，不连浏览器、不改数据源）
 *
 * 做的事：
 *   1. 读 data/work/<platform>-jd-<date>*.json，按平台 + 岗位 ID 去重
 *   2. 从 JD 正文裁出「职位介绍 → 其他信息」区段（避开推荐位/页脚污染）
 *   3. 词表 + 英文技术 token 双路统计，按命中 JD 数倒排（同分按总词频）
 *   4. 输出 reports/关键词排名_<date>.md + data/work/jd-keywords-<date>.json
 *
 * daily 会把它放在末尾调用（传内存 summary）；单独跑时自动解析当日 daily-run log。
 *
 * 用法：node src/cli.mjs keywords [--date 20261027] [--top 30]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA, REPORTS_DIR, writeJSONAtomic } from '../core/io.mjs';

// ---------------------------------------------------------------- 1. log

function findLog(date) {
  try {
    const hit = fs.readdirSync(DATA.logs)
      .filter((f) => f.startsWith(`daily-run-${date}-`) && f.endsWith('.log'))
      .sort()
      .pop();
    return hit ? path.join(DATA.logs, hit) : null;
  } catch { return null; }
}

function parseLog(file) {
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const out = { file: path.basename(file), stage: {}, scanKeywords: [], apply: null, dropReasons: null };
  const collected = text.match(/采集完成：去重 (\d+) 岗｜上限≥25K：(\d+)/);
  if (collected) out.stage.collected = { dedup: +collected[1], capOk: +collected[2] };
  const coarse = text.match(/粗筛通过 (\d+)（剔除 (\d+)）｜待核验 (\d+)/);
  if (coarse) out.stage.coarse = { pass: +coarse[1], drop: +coarse[2], todo: +coarse[3] };
  const verified = text.match(/核验完成：(\d+) 条/);
  if (verified) out.stage.verified = +verified[1];
  const picked = text.match(/核验 (\d+) → 入选 (\d+)，剔除 (\d+)/);
  if (picked) out.stage.targets = { verified: +picked[1], picked: +picked[2], dropped: +picked[3] };
  const reasons = text.match(/剔除原因：(\{[\s\S]*?\n\})/);
  if (reasons) { try { out.dropReasons = JSON.parse(reasons[1]); } catch { /* 忽略 */ } }
  const applied = text.match(/投递完成：成功 (\d+) \/ 已沟通 (\d+) \/ 跳过 (\d+) \/ 未知 (\d+) \/ 失败 (\d+)/);
  if (applied) out.apply = { ok: +applied[1], already: +applied[2], skipped: +applied[3], unknown: +applied[4], fail: +applied[5] };

  // 采集关键词：--- <kw> --- 后紧跟「新增 N（累计 M）」。
  // 同一份 daily log 可能含多个平台段落，累计口径各自独立，必须带平台分组。
  let cur = null;
  let curPlat = null;
  for (const line of text.split(/\r?\n/)) {
    const p = line.match(/^##########\s+([a-z0-9]+)\s+##########$/);
    if (p) { curPlat = p[1]; cur = null; continue; }
    const m = line.match(/^---\s+(.+?)\s+---$/);
    if (m) { cur = /^\d+\./.test(m[1]) ? null : m[1]; continue; }
    const n = cur && line.match(/新增 (\d+)（累计 (\d+)）/);
    if (n) {
      out.scanKeywords.push({ platform: curPlat, keyword: cur, added: +n[1], cumulative: +n[2] });
      cur = null;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 2. JD 数据

function loadJds(date) {
  const files = fs.existsSync(DATA.work)
    ? fs.readdirSync(DATA.work).filter((f) => f.endsWith('.json') && f.includes(`-jd-${date}`)).sort()
    : [];
  const rows = [];
  const used = [];
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(DATA.work, f), 'utf8')); } catch { continue; }
    if (!Array.isArray(data)) continue;
    const platform = f.split('-jd-')[0];
    used.push(f);
    for (const r of data) {
      if (!r || !r.jd) continue;
      r.__key = platform + '|' + (r.id || r.url || `${r.title}|${r.sal}`);
      rows.push(r);
    }
  }
  const seen = new Set();
  const unique = rows.filter((r) => (seen.has(r.__key) ? false : (seen.add(r.__key), true)));
  return { rows: unique, files: used, raw: rows.length };
}

// ---------------------------------------------------------------- 3. 正文裁剪

const START = ['职位介绍', '职位描述', '岗位职责', '工作职责', '任职要求', '职位要求', '岗位要求', '工作内容'];
const END = ['其他信息', '公司信息', '猎聘温馨提示', '猜你喜欢', '相关推荐', '相关公司', '热门城市', '周边城市', '查看全部', '工商信息', '公司介绍'];
const CHROME = /^(首页|职位|校园|海归|简历优化|关于猎聘|我要招人|你好，.*|邀请应聘|我的投递|我的收藏|猎聘APP|投诉建议|聊一聊|收藏.*|查看全部|搜索|相关推荐|相关公司|热门城市|周边城市)$/;

function jdSection(jd) {
  const t = String(jd || '');
  let start = -1;
  for (const m of START) {
    const i = t.indexOf(m);
    if (i >= 0 && (start < 0 || i < start)) start = i;
  }
  if (start < 0) start = 0;
  let end = t.length;
  for (const m of END) {
    const i = t.indexOf(m, start + 1);
    if (i >= 0 && i < end) end = i;
  }
  const body = t.slice(start, end).split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !CHROME.test(s))
    .join('\n');
  return body || t.slice(0, 4000);
}

// ---------------------------------------------------------------- 4. 词表

// [规范名, 类别, 正则]（中文按字面匹配，英文统一大小写不敏感）
const VOCAB = [
  ['C#', '语言/框架', /c#|c\s?sharp/i],
  ['.NET', '语言/框架', /\.net(?!\s*framework)|dotnet/i],
  ['ASP.NET', '语言/框架', /asp\.net/i],
  ['.NET Core', '语言/框架', /\.net\s*core|net core/i],
  ['WPF', '语言/框架', /wpf/i],
  ['WinForm', '语言/框架', /winform|windows\s*forms/i],
  ['C++', '语言/框架', /c\+\+/i],
  ['MFC', '语言/框架', /\bmfc\b/i],
  ['Java', '语言/框架', /\bjava\b(?!script)/i],
  ['Python', '语言/框架', /python/i],
  ['Qt', '语言/框架', /\bqt\b|qt5|qt6|qtcreator/i],
  ['LabVIEW', '语言/框架', /labview/i],
  ['VB/VB.NET', '语言/框架', /\bvb\.?net\b|\bvb6?\b/i],
  ['Delphi', '语言/框架', /delphi/i],
  ['JavaScript', '语言/框架', /javascript|\bjs\b/i],
  ['Vue', '语言/框架', /\bvue\b/i],
  ['React', '语言/框架', /\breact\b/i],
  ['Spring', '语言/框架', /spring\s*boot|\bspring\b/i],

  ['上位机', '工控/设备', /上位机/i],
  ['运动控制', '工控/设备', /运动控制|运控/i],
  ['工控', '工控/设备', /工控|工业控制/i],
  ['非标自动化', '工控/设备', /非标/i],
  ['自动化', '工控/设备', /自动化/i],
  ['PLC', '工控/设备', /\bplc\b|西门子|三菱|欧姆龙|倍福|汇川/i],
  ['伺服', '工控/设备', /伺服/i],
  ['电机', '工控/设备', /电机/i],
  ['传感器', '工控/设备', /传感器/i],
  ['数据采集', '工控/设备', /数据采集|数采/i],
  ['通信', '通信/协议', /通信|通讯/i],
  ['串口', '通信/协议', /串口|rs\s?-?232|rs\s?-?485/i],
  ['以太网', '通信/协议', /以太网|网口|ethernet/i],
  ['TCP/IP', '通信/协议', /\btcp\/?ip\b|\btcp\b|\budp\b/i],
  ['Modbus', '通信/协议', /modbus/i],
  ['OPC', '通信/协议', /\bopc\b/i],
  ['MQTT', '通信/协议', /mqtt/i],
  ['HTTP/API', '通信/协议', /\bhttp\b|\bweb\s?api\b|\bwebapi\b|restful/i],
  ['MES', '业务系统', /\bmes\b/i],
  ['EAP', '业务系统', /\beap\b/i],
  ['SECS/GEM', '业务系统', /\bsecs\b|\bgems\b/i],
  ['SCADA', '业务系统', /scada/i],
  ['组态', '业务系统', /组态/i],
  ['ERP', '业务系统', /\berp\b/i],
  ['PDM/PLM', '业务系统', /\bpdm\b|\bplm\b/i],
  ['BOM', '业务系统', /\bbom\b/i],
  ['ETL', '业务系统', /\betl\b/i],
  ['帆软/报表', '业务系统', /帆软|finereport|报表/i],
  ['WMS', '业务系统', /\bwms\b/i],
  ['CRM', '业务系统', /\bcrm\b/i],

  ['视觉', '算法/检测', /视觉/i],
  ['图像处理', '算法/检测', /图像处理|图像算法|图像识别/i],
  ['算法', '算法/检测', /算法/i],
  ['检测', '算法/检测', /检测/i],
  ['标定', '算法/检测', /标定/i],
  ['调试', '算法/检测', /调试/i],
  ['HALCON', '算法/检测', /halcon/i],
  ['VisionPro', '算法/检测', /visionpro/i],

  ['半导体', '行业', /半导体/i],
  ['光伏', '行业', /光伏/i],
  ['锂电/电池', '行业', /锂电|电池/i],
  ['储能', '行业', /储能/i],
  ['汽车', '行业', /汽车|整车/i],
  ['医疗', '行业', /医疗/i],
  ['3C', '行业', /\b3c\b/i],
  ['机器人', '行业', /机器人/i],
  ['新能源', '行业', /新能源/i],
  ['设备', '行业', /设备/i],

  ['嵌入式', '底层/硬件', /嵌入式/i],
  ['固件', '底层/硬件', /固件/i],
  ['单片机/MCU', '底层/硬件', /单片机|\bmcu\b/i],
  ['驱动', '底层/硬件', /驱动/i],
  ['电路/PCB', '底层/硬件', /电路|原理图|\bpcb\b/i],
  ['电气', '底层/硬件', /电气/i],

  ['数据库', '数据/中间件', /数据库/i],
  ['SQL', '数据/中间件', /\bsql\b/i],
  ['SQL Server', '数据/中间件', /sql\s?server|mssql/i],
  ['Oracle', '数据/中间件', /oracle/i],
  ['MySQL', '数据/中间件', /mysql/i],
  ['Redis', '数据/中间件', /redis/i],
  ['MongoDB', '数据/中间件', /mongo/i],
  ['中间件', '数据/中间件', /中间件/i],
  ['微服务', '数据/中间件', /微服务/i],

  ['需求分析', '工程能力', /需求分析|需求调研|需求文档|需求评审/i],
  ['系统设计', '工程能力', /系统设计|架构设计|\b架构\b/i],
  ['面向对象', '工程能力', /面向对象|\boop\b/i],
  ['设计模式', '工程能力', /设计模式/i],
  ['多线程/并发', '工程能力', /多线程|并发|线程/i],
  ['性能优化', '工程能力', /性能优化|调优/i],
  ['测试', '工程能力', /测试/i],
  ['单元测试', '工程能力', /单元测试|自动化测试/i],
  ['接口', '工程能力', /接口|\bapi\b/i],
  ['版本管理', '工程能力', /版本管理|版本控制|\bgit\b|\bsvn\b/i],
  ['部署/运维', '工程能力', /部署|上线|运维/i],
  ['实施/交付', '工程能力', /实施|交付/i],
  ['Linux', '工程能力', /linux|ubuntu|centos/i],
  ['Docker/容器', '工程能力', /docker|容器/i],
  ['文档', '工程能力', /文档/i],
  ['英文/英语', '软技能', /英文|英语/i],
  ['沟通', '软技能', /沟通/i],
  ['出差', '软技能', /出差/i],
  ['团队管理', '软技能', /团队管理|带团队|人员管理|团队建设|管理经验/i],
  ['项目管理', '软技能', /项目管理|项目统筹|项目推进/i],
  ['客户', '软技能', /客户|甲方/i],
  ['外包/驻场', '软技能', /外包|外派|驻场/i],
].map(([name, cat, re]) => ({ name, cat, re: new RegExp(re.source, 'gi') }));

const EN_STOP = new Set(`a an the and or of to in on at by for with from as is are be been being was were will would can could should may might must not no yes this that these those it its their our your his her they we you i he she them us me my
job jobs work working experience years year new good strong basic ability able preferred responsible requirements requirement description responsibilities skills skill knowledge familiar excellent
and/or etc such more than other others within into about over under using use used per all any both each few most some very well also just only own same so than too
company companies team teams project projects position positions candidate candidates salary benefits
`.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------- 5. 统计

function countKeywords(rows, top) {
  const stats = new Map();
  for (const r of rows) {
    const text = `${r.title || ''}\n${jdSection(r.jd)}`;
    for (const w of VOCAB) {
      w.re.lastIndex = 0;
      const n = (text.match(w.re) || []).length;
      if (!n) continue;
      const s = stats.get(w.name) || { keyword: w.name, cat: w.cat, df: 0, total: 0 };
      s.df += 1;
      s.total += n;
      stats.set(w.name, s);
    }
  }
  return [...stats.values()]
    .sort((a, b) => b.df - a.df || b.total - a.total || a.keyword.localeCompare(b.keyword, 'zh'))
    .slice(0, top);
}

function countEnTokens(rows, minDf = 3, top = 30) {
  const stats = new Map();
  for (const r of rows) {
    const text = `${r.title || ''}\n${jdSection(r.jd)}`;
    const toks = (text.match(/[A-Za-z][A-Za-z0-9+#./_-]*/g) || [])
      .map((s) => s.toLowerCase().replace(/[._/-]+$/, ''))
      .filter((s) => s.length >= 2 && s.length <= 16 && !EN_STOP.has(s) && /[a-z]/.test(s));
    for (const t of new Set(toks)) {
      const s = stats.get(t) || { token: t, df: 0, total: 0 };
      s.df += 1;
      stats.set(t, s);
    }
    for (const t of toks) {
      const s = stats.get(t);
      if (s) s.total += 1;
    }
  }
  return [...stats.values()].filter((s) => s.df >= minDf).sort((a, b) => b.df - a.df || b.total - a.total).slice(0, top);
}

const FLAG_LABEL = {
  dotnet: 'C#/.NET', wpf: 'WPF', upper: '上位机', motion: '运动控制', mes: 'MES/EAP/SECS',
  cpp: 'C++', java: 'Java', labview: 'LabVIEW', qt: 'Qt', algo: '算法/视觉',
  embed: '嵌入式/固件', hw: '硬件/PCB', sales: '销售/客户', mgr: '团队管理', plague: '外包/驻场',
};

// 与 core/criteria.mjs 的 techFlags() 同义，但统一加 i：
// 原实现里 cpp 用 /c\+\+/.test(body)、java 用 /java/.test(body)，对 "C++"/"Java" 这类大写写法会漏判。
const FLAG_RE = {
  dotnet: /c#|\.net|asp\.net|winform|wpf|net core/i,
  wpf: /wpf/i,
  upper: /上位机/,
  motion: /运动控制/,
  mes: /\bmes\b|\beap\b|secs|gems/i,
  cpp: /c\+\+/i,
  java: /\bjava\b/i,
  labview: /labview/i,
  qt: /qt5|qtcreator|\bqt\b/i,
  algo: /算法工程师|算法开发|视觉|图像处理|slam/i,
  embed: /嵌入式|固件|单片机|dsp|fpga/i,
  hw: /硬件设计|pcb|电路设计|原理图/i,
  sales: /销售|客户开发|商务拓展/,
  mgr: /部门管理|团队管理|人员管理/,
  plague: /外包|外派|驻场|人力外包|底薪\+提成|计件/,
};

function countFlags(rows) {
  const out = [];
  for (const [k, label] of Object.entries(FLAG_LABEL)) {
    const cleanDf = rows.filter((r) => FLAG_RE[k].test(jdSection(r.jd))).length;
    const pipelineDf = rows.filter((r) => r.flags && r.flags[k]).length;
    if (cleanDf || pipelineDf) out.push({ flag: k, label, df: cleanDf, pipelineDf });
  }
  return out.sort((a, b) => b.df - a.df || b.pipelineDf - a.pipelineDf);
}

// ---------------------------------------------------------------- 6. 输出

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0') + '%';
const mdTable = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');
const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const NUM = ['一', '二', '三', '四', '五', '六'];

/** 采集关键词按平台分组，组内按新增数倒排 */
function groupScan(list) {
  const m = new Map();
  for (const k of list) {
    const p = k.platform || 'unknown';
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(k);
  }
  for (const v of m.values()) v.sort((a, b) => b.added - a.added);
  return m;
}

export async function keywords(opts = {}) {
  const { log = console.log, top = 30, summary = null } = opts;
  const DATE = String(opts.date || ymd());
  const DATEd = `${DATE.slice(0, 4)}-${DATE.slice(4, 6)}-${DATE.slice(6, 8)}`;
  const OUT = opts.out || path.join(REPORTS_DIR, `关键词排名_${DATEd}.md`);
  const JSON_OUT = opts.jsonOut || path.join(DATA.work, `jd-keywords-${DATE}.json`);

  const logFile = opts.logFile || (summary ? null : findLog(DATE));
  const parsedLog = summary ? null : parseLog(logFile);
  const scanKeywords = (opts.scanKeywords && opts.scanKeywords.length ? opts.scanKeywords : (parsedLog ? parsedLog.scanKeywords : []));
  const { rows, files, raw } = loadJds(DATE);
  const total = rows.length;
  if (!total) throw new Error(`没有找到 ${DATEd} 的 JD 数据（data/work/*-jd-${DATE}*.json）`);

  const kw = countKeywords(rows, top);
  const enTokens = countEnTokens(rows);
  const flags = countFlags(rows);
  const missing = rows.filter((r) => jdSection(r.jd).length < 120).length;

  // ---- 台面输出
  log(`\n=== ${DATEd} JD 关键词排行 ===`);
  log(`文件 ${files.length} 个｜原始 ${raw} 条｜去重后 ${total} 条｜正文过短 ${missing} 条`);
  if (parsedLog) {
    const s = parsedLog.stage;
    log(`Log：${parsedLog.file}`);
    if (s.collected) log(`  采集去重 ${s.collected.dedup}｜上限≥25K ${s.collected.capOk}`);
    if (s.coarse) log(`  粗筛通过 ${s.coarse.pass}（剔除 ${s.coarse.drop}）`);
    if (s.targets) log(`  入选 ${s.targets.picked}｜剔除 ${s.targets.dropped}`);
    if (parsedLog.apply) log(`  投递 成功 ${parsedLog.apply.ok} / 已沟通 ${parsedLog.apply.already} / 失败 ${parsedLog.apply.fail}`);
  }
  if (scanKeywords.length) {
    for (const [pid, list] of groupScan(scanKeywords)) {
      log(`\n-- 采集关键词（${pid}，按新增岗位数倒排）--`);
      list.forEach((k, i) => log(`${String(i + 1).padStart(2)}. ${k.keyword.padEnd(10, ' ')} 新增 ${k.added}  累计 ${k.cumulative}`));
    }
  }
  log(`\n-- JD 关键词 Top ${Math.min(15, kw.length)}（按命中 JD 数倒排）--`);
  kw.slice(0, 15).forEach((k, i) => {
    log(`${String(i + 1).padStart(2)}. ${k.keyword.padEnd(12, ' ')} ${String(k.df).padStart(3)} 份 (${pct(k.df, total)})  词频 ${k.total}  [${k.cat}]`);
  });
  log('\n-- 技术栈标记（正文重算 / 整页流水线）--');
  flags.slice(0, 10).forEach((f) => log(`${f.label.padEnd(12, ' ')} ${String(f.df).padStart(3)} 份 (${pct(f.df, total)})  整页 ${f.pipelineDf}`));

  // ---- 报告
  const lines = [];
  let n = 0;
  const h = (title) => { lines.push('', `## ${NUM[n++]}、${title}`, ''); };
  lines.push(`# 当日 JD 关键词排行（${DATEd}）`, '');
  lines.push(`> 数据：\`data/work/${files.join('`、`')}\` 去重后 **${total}** 份 JD。`, '');

  const plats = summary?.platforms ? Object.entries(summary.platforms) : [];
  if (plats.length) {
    h('当日流水线');
    lines.push(mdTable(['平台', '采集', 'JD 核验', '入选', '投递 成功/已沟通/失败'], plats.map(([pid, p]) => [
      pid,
      p.scan?.total ?? '—',
      p.jd?.count ?? '—',
      p.targets?.count ?? '—',
      p.apply ? `${p.apply.ok} / ${p.apply.already} / ${p.apply.fail}` : (p.skipped ? `跳过:${p.skipped}` : '—'),
    ])));
    if (summary.env?.platforms) {
      const bad = Object.entries(summary.env.platforms).filter(([, v]) => v && v.ok === false).map(([pid]) => pid);
      if (bad.length) lines.push('', `> 未登录/跳过：${bad.join('、')}`);
    }
  } else if (parsedLog) {
    h('Log 概览');
    const st = [];
    if (parsedLog.stage.collected) st.push(['采集去重', parsedLog.stage.collected.dedup, '岗']);
    if (parsedLog.stage.collected) st.push(['薪资上限 ≥25K', parsedLog.stage.collected.capOk, '岗']);
    if (parsedLog.stage.coarse) st.push(['粗筛通过', parsedLog.stage.coarse.pass, `岗（剔除 ${parsedLog.stage.coarse.drop}）`]);
    if (parsedLog.stage.verified) st.push(['JD 实读核验', parsedLog.stage.verified, '条']);
    if (parsedLog.stage.targets) st.push(['投递清单入选', parsedLog.stage.targets.picked, `条（剔除 ${parsedLog.stage.targets.dropped}）`]);
    if (parsedLog.apply) st.push(['最终投递', `${parsedLog.apply.ok} 成功 / ${parsedLog.apply.already} 已沟通 / ${parsedLog.apply.fail} 失败`, '']);
    lines.push(mdTable(['阶段', '数量', '说明'], st));
    if (parsedLog.dropReasons) {
      lines.push('', '剔除原因：', '');
      lines.push(mdTable(['原因', '条数'], Object.entries(parsedLog.dropReasons).map(([k, v]) => [k, v])));
    }
  }

  const scanGroups = groupScan(scanKeywords);
  if (scanGroups.size) {
    h('采集关键词效果（按新增岗位数倒排）');
    const srows = [];
    for (const [pid, list] of scanGroups) {
      list.forEach((k, i) => srows.push([pid, i + 1, k.keyword, k.added, k.cumulative]));
    }
    lines.push(mdTable(['平台', '排名', '采集关键词', '新增岗位', '累计'], srows));
    lines.push('', '> 增量口径：关键词按顺序采集，新增数受前面关键词去重后的剩余池影响，排名只反映「当轮边际产出」；各平台累计独立。');
  }

  const maxDf = kw[0]?.df || 1;
  h(`JD 关键词排行（标题 + 裁后正文，${total} 份 JD，按命中 JD 数倒排）`);
  lines.push(mdTable(['排名', '关键词', '类别', '命中 JD', '覆盖率', '总词频', '词频条'],
    kw.map((k, i) => [
      i + 1, k.keyword, k.cat, k.df, pct(k.df, total), k.total,
      '█'.repeat(Math.max(1, Math.round((k.df / maxDf) * 18))),
    ])));
  lines.push('', `> 覆盖率为「提到该词的 JD 数 ÷ 有效 JD 总数 ${total}」；统计文本 = 岗位标题 + 裁后正文，同分按总词频排序。`);

  h('结构化技术栈分布（按裁后正文重算）');
  lines.push(mdTable(['技术栈', '标记', '正文命中', '覆盖率', '流水线标记（整页）'],
    flags.map((f) => [f.label, f.flag, f.df, pct(f.df, total), f.pipelineDf])));
  lines.push('', '> 「流水线标记」是 `jd` 阶段读整页 `innerText` 的结果，含「猜你喜欢 / 热门城市」推荐位，会虚高（如销售、嵌入式）。');
  lines.push('> 另：`core/criteria.mjs` 的 `techFlags()` 里 `cpp`/`java` 正则未加 `i`，对「C++」「Java」大写写法漏判，故本表按大小写不敏感重算。');

  h('高频英文技术词（自动抽取）');
  lines.push(mdTable(['排名', 'token', '命中 JD', '覆盖率', '总词频'],
    enTokens.map((t, i) => [i + 1, t.token, t.df, pct(t.df, total), t.total])));

  h('口径与局限');
  lines.push(`- 正文只取「职位介绍/职位描述 → 其他信息/猜你喜欢」区段，避免推荐位与页脚关键词污染；正文 <120 字符的 ${missing} 条保留原样。`);
  lines.push('- 中文无分词器，关键词走**预置词表**字面匹配；英文 token 走正则抽取（去掉停用词、要求命中 ≥3 份 JD），用于兜住词表外的技术词。');
  lines.push('- 去重键 = 平台 + 岗位 ID；同一天多次核验的重复记录只算一次。');
  lines.push('- 仅统计出现频次，不代表岗位质量或匹配度。');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

  const payload = {
    date: DATEd,
    generatedAt: new Date().toISOString(),
    totalJd: total,
    files,
    log: parsedLog ? { file: parsedLog.file, stage: parsedLog.stage, apply: parsedLog.apply, dropReasons: parsedLog.dropReasons } : null,
    scanKeywords,
    keywords: kw,
    enTokens,
    flags,
  };
  writeJSONAtomic(JSON_OUT, payload);

  log(`\n报告 -> ${OUT}`);
  log(`明细 -> ${JSON_OUT}`);
  return { total, files, out: OUT, jsonOut: JSON_OUT, keywords: kw };
}

export const help = 'keywords [--date YYYYMMDD] [--top N] [--out file] [--json-out file]';
