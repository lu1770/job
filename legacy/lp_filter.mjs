// 猎聘候选筛选：薪资上限≥25K + 相关性（.NET/C#/上位机 开发主线）+ 公司屏蔽名单
import fs from 'node:fs';
import { blockedCompany } from './blocklist.mjs';

const IN = process.argv[2] || 'lp_scan_raw.json';
const OUT = process.argv[3] || 'lp_candidates.json';
const all = JSON.parse(fs.readFileSync(IN, 'utf8'));

// 明确排除（按标题）
const EXCLUDE = [
  /C\+\+|QT|Qt|java|Java|JAVA|python|Python|Golang|PHP|前端|Android|iOS|IOS/,
  /算法|视觉|图像|SLAM|AI|人工智能|大模型|数据科学|数据挖掘|机器学习/,
  /硬件|嵌入式|固件|FPGA|DSP|单片机|PCB|电子|射频|天线|驱动开发/,
  /电气|PLC|伺服|变频|电机|电控|编码器|液冷|机械|结构|工艺|制程|IE工程师/,
  /测试|运维|技术支持|实施顾问|SAP|JDE|Dynamics|用友|金蝶|BA|业务分析/,
  /销售|商务|采购|供应链|市场|客户|售前|售后|渠道/,
  /总监|总经理|部长|厂长|主管|董事长|合伙人|产品经理|项目经理|PMO|咨询/,
  /运营|仓储|物流|生产|质量|设备|制造流程|计划/,
  /架构师(?!.*软件)|数字化|信息化/,
  /财务|人事|行政|法务/,
];

// 必须命中（开发主线）
const REQUIRE = [/软件工程师|软件开发|开发工程师|上位机|程序开发|程序员|软件研发|软件开发工程师|EAP|MES|C#|\.NET|net开发|WPF|WinForm/];
// 加分：明确 .NET / C# / 上位机
const STRONG = [/上位机|C#|c#|\.NET|\.net|WPF|WinForm|winform|Winform|MES开发|MES系统|EAP/];

function score(j) {
  const t = j.title || '';
  for (const re of EXCLUDE) if (re.test(t)) return null;
  if (!REQUIRE.some((re) => re.test(t))) return null;
  const strong = STRONG.some((re) => re.test(t));
  return { tier: strong ? 'A' : 'B' };
}

const out = [];
const blocked = [];
for (const j of all) {
  if (j.maxK < 25) continue;
  const blk = blockedCompany(j.txt) || blockedCompany((j.parts || []).join(' '));
  if (blk) { blocked.push({ ...j, why: blk }); continue; }
  const s = score(j);
  if (!s) continue;
  out.push({ ...j, tier: s.tier });
}
// A 档优先
out.sort((a, b) => (a.tier === b.tier ? b.maxK - a.maxK : a.tier === 'A' ? -1 : 1));

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
if (blocked.length) console.log(`屏蔽命中：${blocked.length} 条（${[...new Set(blocked.map((b) => b.why))].join(', ')}）\n`);
console.log(`上限≥25K 且相关：${out.length}（A档 ${out.filter((x) => x.tier === 'A').length} / B档 ${out.filter((x) => x.tier === 'B').length}）\n`);
for (const j of out) {
  console.log(`[${j.tier}] ${j.sal.padEnd(10)} | ${j.title.replace(/\s*\|\s*$/, '')} | ${(j.parts[5] || j.parts[4] || '').slice(0, 26)} | ${j.kw}`);
}
