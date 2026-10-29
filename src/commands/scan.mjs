/**
 * 命令：scan —— 多关键词采集岗位（原始结果落 data/raw/）
 *
 * 用法：node src/cli.mjs scan --platform boss --keywords ".NET,C#,上位机"
 */
import { session } from '../core/session.mjs';
import { parseList } from '../platforms/index.mjs';
import { dataPath, writeJSONAtomic } from '../core/io.mjs';
import { capK } from '../core/salary.mjs';
import { jobIdOf } from '../core/dedupe.mjs';
import { sleep } from '../core/cdp.mjs';

export async function scan(opts = {}) {
  const { platform: pid, keywords, out, capKMin = 25, log = console.log } = opts;
  // 平台内多刷新次数（如 BOSS 推荐视图靠反复刷新换结果去重；1 = 关闭）
  const refresh = opts.refresh ? Number(opts.refresh) : undefined;
  const { cdp, platform } = await session(pid, { tabId: opts.tabId });
  // 没给 --keywords 时用平台默认词表（daily 会优先传上一日关键词 Top10）
  const kws = parseList(keywords, platform.DEFAULT_KEYWORDS || []);

  const file = out || dataPath('raw', `${pid}-scan`);
  const all = [];
  const kwStats = [];
  const seen = new Set();
  let stopped = null;

  log(`\n=== ${platform.label} 采集 | 关键词 ${kws.length} 个${refresh ? ` | 每关键词刷新 ${refresh} 次` : ''} ===`);
  for (const kw of kws) {
    if (stopped) break;
    log(`--- ${kw} ---`);
    let res;
    try {
      res = await platform.scanKeyword(cdp, kw, refresh ? { refresh } : {});
    } catch (e) {
      log(`  !! ${kw} 出错: ${e.message}（跳过该关键词）`);
      continue;
    }
    if (res.stopped) { stopped = res.stopped; log(`  !! 停止：${JSON.stringify(res.stopped)}`); break; }
    // diagnostic 有两种含义：页面没采到卡（真问题）/ 采集元信息（如 BOSS 的多刷新统计）。
    // 只把前者当异常报出，后者正常打印。
    if (res.diagnostic && res.diagnostic.reason) {
      log(`  !! 页面未发现职位卡片：${JSON.stringify(res.diagnostic)}`);
    }

    let items = platform.normalize ? platform.normalize(res.items) : res.items;
    let added = 0;
    let dupInKeyword = 0;
    const kwSeen = new Set();
    for (const j of items) {
      const id = jobId(platform, j);
      if (!id) continue;
      if (kwSeen.has(id)) { dupInKeyword++; continue; }   // 平台内部去重（多刷新合并后仍可能有）
      kwSeen.add(id);
      if (seen.has(id)) continue;                          // 跨关键词去重
      seen.add(id);
      all.push({ ...j, id, kw, capK: capK(j.sal || j.salary), url: j.url || j.href });
      added++;
    }
    // 多刷新合并的元信息（如 BOSS「刷新 3 次，第2次新增 8…」）
    const d = res.diagnostic;
    if (d && d.stats) {
      log(`  刷新 ${d.refreshes} 次：${d.stats.map((s) => `${s.got}(+${s.added})`).join(' → ')}`
        + (dupInKeyword ? ` | 合并后重复 ${dupInKeyword}` : ''));
    }
    log(`  扫到 ${items.length}，新增 ${added}（累计 ${all.length}）`);
    kwStats.push({ keyword: kw, added, cumulative: all.length });
    writeJSONAtomic(file, all);   // 增量落盘：中途挂起也不丢
    await sleep(2500);
  }

  const hit = all.filter((j) => j.capK >= capKMin);
  writeJSONAtomic(file, all);
  log(`\n采集完成：去重 ${all.length} 岗｜上限≥${capKMin}K：${hit.length}`);
  if (stopped) log(`⚠️ 未跑完：${JSON.stringify(stopped)}`);
  cdp.close();
  return { file, total: all.length, hit: hit.length, stopped, keywords: kwStats, items: all };
}

/** 岗位 id：统一走 core/dedupe 的唯一实现；无 ID_RE 平台（智联）退回 href */
function jobId(platform, j) {
  return jobIdOf(j, platform.ID_RE) || j.href || j.url || '';
}

export const help = 'scan --platform <boss|liepin|job51|zhaopin|yupaopin> [--keywords "a,b"] [--cap 25] [--tab <id>]';