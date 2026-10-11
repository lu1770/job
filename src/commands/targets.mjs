/**
 * 命令：targets —— 从 JD 核验结果生成最终投递清单（落 data/lists/）
 *
 * 判定顺序：核验异常 → 屏蔽名单 → 年龄限制 → 标题排除 → JD 技术栈屏蔽 → 管理岗 → JD 必须实证 .NET
 *
 * 用法：node src/cli.mjs targets --platform boss --in data/work/boss-jd-xxx.json
 */
import { readJSON, latestDataFile, writeJSONAtomic, dataPath } from '../core/io.mjs';
import { getPlatform } from '../platforms/index.mjs';
import { blockedCompany, screenTitle, screenJdFlags, tierOf, criteria } from '../core/criteria.mjs';

/** 管理 / 非开发岗 */
const MGMT = /总监|总经理|部长|厂长|合伙人|人事|主管|负责人|经理|解决方案|架构师(?!.*软件)/;

export async function targets(opts = {}) {
  const { platform: pid, log = console.log } = opts;
  const resolveUrl = (getPlatform(pid).resolveUrl) || ((j) => j.url || j.href);
  const inFile = opts.in || latestDataFile('work', `${pid}-jd`);
  if (!inFile) throw new Error(`找不到 ${pid} 的 JD 核验结果，请先跑 jd`);
  const rows = readJSON(inFile, []) || [];

  const keep = [];
  const dropped = [];
  const reasons = {};
  const bump = (w) => { reasons[w] = (reasons[w] || 0) + 1; };

  for (const r of rows) {
    const title = r.title || r.name || '';
    // 兼容历史产物：老脚本用 f，新流水线用 flags
    const flags = r.flags || r.f || {};
    if (r.err || r.stopped || r.slider) { dropped.push({ ...r, why: '核验异常' }); bump('核验异常'); continue; }
    const blk = blockedCompany(r.company || r.txt || '');
    if (blk) { dropped.push({ ...r, why: `屏蔽:${blk}` }); bump(`屏蔽:${blk}`); continue; }
    if (r.ageLimit) { dropped.push({ ...r, why: `年龄限制:${r.ageLimit.hit}` }); bump('年龄限制'); continue; }
    const s = screenTitle(title);
    if (!s.ok) { dropped.push({ ...r, why: s.why }); bump('标题排除'); continue; }
    const jdEx = screenJdFlags(flags);
    if (!jdEx.ok) { dropped.push({ ...r, why: jdEx.why }); bump('JD技术栈屏蔽'); continue; }
    if (MGMT.test(title)) { dropped.push({ ...r, why: '管理/非开发岗' }); bump('管理/非开发岗'); continue; }
    // 兼容历史产物：老脚本用 f.csharp，新流水线用 flags.dotnet
    const hasDotNet = !!(flags.dotnet ?? flags.csharp);
    if (criteria().requireDotNetInJd && !hasDotNet) {
      dropped.push({ ...r, why: 'JD 无 C#/.NET 栈' }); bump('JD 无 C#/.NET 栈'); continue;
    }
    keep.push({
      id: r.id, title, sal: r.sal, company: r.company || (r.parts && r.parts[5]) || '',
      loc: r.loc || r.city || '', url: resolveUrl(r), href: r.href,
      tier: tierOf(title), kw: r.kw, jdTitle: r.jdTitle || '',
    });
  }

  keep.sort((a, b) => (a.tier === b.tier ? (b.capK || 0) - (a.capK || 0) : a.tier === 'A' ? -1 : 1));

  const file = opts.out || dataPath('lists', `${pid}-targets`);
  writeJSONAtomic(file, keep);
  writeJSONAtomic(file.replace(/\.json$/, '.dropped.json'), dropped);

  log(`【${pid}】核验 ${rows.length} → 入选 ${keep.length}，剔除 ${dropped.length}`);
  log(`剔除原因：${JSON.stringify(reasons, null, 1)}`);
  log(`清单 -> ${file}`);
  if (opts.show !== false) keep.slice(0, opts.showN || 20).forEach((x, i) => log(`${i + 1}. ${(x.sal || '').padEnd(12)} | ${x.title} | ${x.company} | ${x.loc}`));
  return { file, keep, dropped };
}

export const help = 'targets --platform <id> [--in <jd.json>] [--show false]';