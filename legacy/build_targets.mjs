// 生成最终投递清单：JD 相关性定稿 + 公司屏蔽
import fs from 'node:fs';
import { blockedCompany } from './blocklist.mjs';

// 人工剔除（JD 核验后判定与本岗方向不符 / 非苏州用人单位 / 主栈非 .NET）
const BOSS_DROP = [
  { k: '上海C# 高级软件工程师 35K+包吃包住', why: '岗位标题即为上海，广州公司发布，非苏州用人单位' },
  { k: '软件工程师（c#/运动控制/大厂直签）', why: '客户公司为东莞企业，非苏州用人单位' },
];
const LP_DROP_TITLE = [/经理|负责人|总监|专家|解决方案|架构师(?!.*软件)/];

const boss = JSON.parse(fs.readFileSync('boss_jd_today.json', 'utf8'));
const lp = JSON.parse(fs.readFileSync('lp_jd.json', 'utf8'));

// ---- BOSS ----
const bossKeep = [];
const bossDrop = [];
for (const x of boss) {
  const f = x.f || {};
  if (x.err || x.slider) { bossDrop.push({ ...x, why: '核验异常' }); continue; }
  const blk = blockedCompany(x.company);
  if (blk) { bossDrop.push({ ...x, why: '屏蔽:' + blk }); continue; }
  if (x.ageLimit) { bossDrop.push({ ...x, why: '年龄限制:' + x.ageLimit.hit }); continue; }
  const manual = BOSS_DROP.find((d) => x.name.includes(d.k));
  if (manual) { bossDrop.push({ ...x, why: manual.why }); continue; }
  if (!f.csharp) { bossDrop.push({ ...x, why: 'JD 无 C#/.NET 栈（判定为 C++/嵌入式等）' }); continue; }
  bossKeep.push(x);
}

// ---- 猎聘 ----
const lpKeep = [];
const lpDrop = [];
for (const x of lp) {
  const f = x.f || {};
  if (x.err || x.slider) { lpDrop.push({ ...x, why: '核验异常' }); continue; }
  const blk = blockedCompany(x.txt) || blockedCompany((x.parts || []).join(' '));
  if (blk) { lpDrop.push({ ...x, why: '屏蔽:' + blk }); continue; }
  if (x.ageLimit) { lpDrop.push({ ...x, why: '年龄限制:' + x.ageLimit.hit }); continue; }
  const t = x.title.replace(/\s*\|\s*$/, '');
  if (LP_DROP_TITLE.some((re) => re.test(t))) { lpDrop.push({ ...x, why: '管理/非开发岗' }); continue; }
  if (!f.csharp) { lpDrop.push({ ...x, why: 'JD 无 C#/.NET 栈' }); continue; }
  lpKeep.push({ title: t, sal: x.sal, href: x.href, tier: x.tier, already: /继续聊|已沟通|已投递/.test(x.excerpt || '') });
}

fs.writeFileSync('boss_targets_today.json', JSON.stringify(bossKeep, null, 1));
fs.writeFileSync('lp_targets_today.json', JSON.stringify(lpKeep, null, 1));
fs.writeFileSync('_targets_dropped.json', JSON.stringify({ bossDrop, lpDrop }, null, 1));

console.log(`【BOSS】核验 ${boss.length} → 入选 ${bossKeep.length}，剔除 ${bossDrop.length}`);
console.log(`【猎聘】核验 ${lp.length} → 入选 ${lpKeep.length}（页面已显示"继续聊"=上轮已联系：${lpKeep.filter((x) => x.already).length}）\n`);
console.log('=== BOSS 投递清单 ===');
bossKeep.forEach((x, i) => console.log(`${i + 1}. ${x.sal.padEnd(12)} | ${x.name} | ${x.company} | ${x.loc}`));
console.log('\n=== 猎聘 投递清单 ===');
lpKeep.forEach((x, i) => console.log(`${i + 1}. ${x.sal.padEnd(12)} | ${x.title} | ${x.already ? '已联系' : '新'}`));
console.log('\n=== BOSS 剔除 ===');
bossDrop.forEach((x) => console.log(`- ${x.name} | ${x.sal} | ${x.why}`));
console.log('\n=== 猎聘 剔除 ===');
lpDrop.forEach((x) => console.log(`- ${x.title.replace(/\s*\|\s*$/, '')} | ${x.sal} | ${x.why}`));
