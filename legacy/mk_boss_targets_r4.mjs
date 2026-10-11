// BOSS 最终投递清单（第4轮）：以 JD 实证 C#/.NET 为准，标题层面剔除明确非 .NET 域/非开发岗
import fs from 'node:fs';
import { blockedCompany } from './blocklist.mjs';

const IN = process.argv[2] || 'boss_jd_today.json';
const OUT = process.argv[3] || 'boss_targets_today.json';
const jd = JSON.parse(fs.readFileSync(IN, 'utf8'));

const EXCLUDE = [
  /c\+\+|cpp|\bqt\b|qt5|java|python|golang|php|前端|android|ios|vue|react/i,
  /算法|视觉|图像|slam|大模型|机器学习|人工智能|具身|机器人/i,
  /硬件|fpga|dsp|pcb|射频|天线|电路|电气|plc|伺服|变频|电机|电控|编码器|机械|结构|工艺|制程/i,
  /嵌入式|固件|单片机|底层|驱动|内核|autosar|mcu|bios|bsp|\barm\b|rtos|\bsoc\b|\bsdk\b|\bbms\b|逆变|储能|电源|雷达|感知|智驾|自动驾驶|adas|编译器|llvm|gpu|vulkan|cuda|eda|数控|\bisp\b|麦克风/i,
  /测试|运维|技术支持|实施|售前|售后|\bfae\b|解决方案|顾问|业务分析|\bba\b|客户成功/i,
  /销售|商务|采购|供应链|市场|客户|渠道|总监|总经理|部长|厂长|人力资源|教务/i,
  /产品经理|项目经理|pmo|咨询|运营|仓储|物流|生产|质量|计划员|主管|负责人|经理/i,
  /架构师(?!.*软件)/i,
];

const keep = [];
const drop = [];
for (const x of jd) {
  const f = x.f || {};
  const t = (x.name || '').trim();
  if (x.err || x.slider) { drop.push({ ...x, why: '核验异常' }); continue; }
  const blk = blockedCompany(x.company);
  if (blk) { drop.push({ ...x, why: '屏蔽:' + blk }); continue; }
  if (x.ageLimit) { drop.push({ ...x, why: '年龄限制:' + x.ageLimit.hit }); continue; }
  if (!f.csharp) { drop.push({ ...x, why: 'JD 无 C#/.NET 栈' }); continue; }
  const bad = EXCLUDE.find((re) => re.test(t));
  if (bad) { drop.push({ ...x, why: '标题排除:' + String(bad) }); continue; }
  keep.push(x);
}

fs.writeFileSync(OUT, JSON.stringify(keep, null, 1));
fs.writeFileSync('_boss_dropped_r4.json', JSON.stringify(drop, null, 1));
const byWhy = {};
for (const d of drop) byWhy[d.why] = (byWhy[d.why] || 0) + 1;
console.log(`【BOSS】核验 ${jd.length} → 入选 ${keep.length}，剔除 ${drop.length}`);
console.log('剔除原因分布:', JSON.stringify(byWhy, null, 1));
console.log('\n=== BOSS 投递清单 ===');
keep.forEach((x, i) => console.log(`${i + 1}. ${(x.sal || '').padEnd(12)} | ${x.name} | ${x.company} | ${x.loc}`));
