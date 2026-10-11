// BOSS 候选筛选：薪资上限≥25K + 相关性 + 跨轮次去重 + 公司屏蔽名单
import fs from 'node:fs';
import { blockedCompany } from './blocklist.mjs';

const IN = process.argv[2] || 'boss_scan_today.json';
const OUT = process.argv[3] || 'boss_candidates_today.json';
const HIST = process.argv[4] || '_hist_boss.json';
const all = JSON.parse(fs.readFileSync(IN, 'utf8'));
let hist = { ids: [], nameCo: [] };
try { hist = JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch {}
const histIds = new Set(hist.ids || []);
const histNC = new Set(hist.nameCo || []);

const EXCLUDE = [
  /C\+\+|QT|Qt|java|Java|JAVA|python|Python|Golang|PHP|前端|Android|iOS|IOS|嵌入式|固件|单片机/,
  /算法|视觉|图像|SLAM|AI|人工智能|大模型|数据科学|数据挖掘|机器学习|机器人|具身/,
  /硬件|FPGA|DSP|PCB|射频|天线|驱动|电子|电路/,
  /电气|PLC|伺服|变频|电机|电控|编码器|液冷|机械|结构|工艺|制程|IE工程师/,
  /测试|运维|技术支持|实施|顾问|SAP|MES售前|FAE|AE|PE工程师|售后|售前/,
  /销售|商务|采购|供应链|市场|客户|渠道|总监|总经理|部长|厂长|董事长|合伙人|人力资源|教务/,
  /产品经理|项目经理|PMO|咨询|运营|仓储|物流|生产|质量|计划|总监|经理|主管|负责人/,
  /架构师(?!.*软件)/,
];

const REQUIRE = [/软件工程师|软件开发|开发工程师|上位机|程序员|软件研发|EAP|MES|C#|\.NET|net开发|WPF|WinForm|Secs|SECS/];
const STRONG = [/上位机|C#|c#|\.NET|\.net|WPF|WinForm|winform|MES|EAP|Secs|SECS/];

const out = [];
const dropped = [];
for (const j of all) {
  if (j.maxK < 25) continue;
  const t = j.name || '';
  if (j.loc && !/苏州/.test(j.loc)) { dropped.push({ ...j, why: '非苏州' }); continue; }
  const blk = blockedCompany(j.company);
  if (blk) { dropped.push({ ...j, why: 'blocked:' + blk }); continue; }
  let bad = null;
  for (const re of EXCLUDE) if (re.test(t)) { bad = String(re); break; }
  if (bad) { dropped.push({ ...j, why: 'exclude:' + bad }); continue; }
  if (!REQUIRE.some((re) => re.test(t))) { dropped.push({ ...j, why: 'notdev' }); continue; }
  const id = (j.href.match(/job_detail\/([^.]+)\.html/) || [])[1] || '';
  const nc = (j.name || '').trim() + '||' + (j.company || '').trim();
  const isHist = histIds.has(id) || histNC.has(nc);
  out.push({ ...j, id, tier: STRONG.some((re) => re.test(t)) ? 'A' : 'B', isHist });
}

const fresh = out.filter((x) => !x.isHist);
fresh.sort((a, b) => (a.tier === b.tier ? b.maxK - a.maxK : a.tier === 'A' ? -1 : 1));

fs.writeFileSync(OUT, JSON.stringify({ candidates: out, fresh, dropped }, null, 1));
console.log(`上限≥25K：${all.filter((j) => j.maxK >= 25).length}`);
console.log(`相关性通过：${out.length}（A档 ${out.filter((x) => x.tier === 'A').length} / B档 ${out.filter((x) => x.tier === 'B').length}）`);
console.log(`其中历史已投/已处理：${out.length - fresh.length}`);
console.log(`\n=== 新增可投候选（${fresh.length}）===`);
for (const j of fresh) {
  console.log(`[${j.tier}] ${(j.sal || '').padEnd(12)} | ${j.name} | ${j.company} | ${j.loc} | ${j.kw}`);
}
fs.writeFileSync('_dropped_boss.json', JSON.stringify(dropped, null, 1));
