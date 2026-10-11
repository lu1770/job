// 仅生成猎聘投递清单（build_targets 的 lp 部分，独立成轮次专用）
import fs from 'node:fs';
import { blockedCompany } from './blocklist.mjs';

const IN = process.argv[2] || 'lp_jd.json';
const OUT = process.argv[3] || 'lp_targets_today.json';
const LP_DROP_TITLE = [/经理|负责人|总监|专家|解决方案|架构师(?!.*软件)/];

const lp = JSON.parse(fs.readFileSync(IN, 'utf8'));
const lpKeep = [];
const lpDrop = [];
for (const x of lp) {
  const f = x.f || {};
  if (x.err || x.slider) { lpDrop.push({ ...x, why: '核验异常' }); continue; }
  const blk = blockedCompany(x.txt) || blockedCompany((x.parts || []).join(' '));
  if (blk) { lpDrop.push({ ...x, why: '屏蔽:' + blk }); continue; }
  if (x.ageLimit) { lpDrop.push({ ...x, why: '年龄限制:' + x.ageLimit.hit }); continue; }
  const t = (x.title || '').replace(/\s*\|\s*$/, '');
  if (LP_DROP_TITLE.some((re) => re.test(t))) { lpDrop.push({ ...x, why: '管理/非开发岗' }); continue; }
  if (!f.csharp) { lpDrop.push({ ...x, why: 'JD 无 C#/.NET 栈' }); continue; }
  lpKeep.push({ title: t, sal: x.sal, href: x.href, tier: x.tier, already: /继续聊|已沟通|已投递/.test(x.excerpt || '') });
}

fs.writeFileSync(OUT, JSON.stringify(lpKeep, null, 1));
console.log(`【猎聘】核验 ${lp.length} → 入选 ${lpKeep.length}，剔除 ${lpDrop.length}`);
lpKeep.forEach((x, i) => console.log(`${i + 1}. ${x.sal.padEnd(10)} | ${x.title} | ${x.already ? '已联系' : '新'}`));
console.log('\n=== 剔除 ===');
lpDrop.forEach((x) => console.log(`- ${(x.title || '').replace(/\s*\|\s*$/, '')} | ${x.sal} | ${x.why}`));
