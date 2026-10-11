/**
 * 命令：scan —— 多关键词采集岗位（原始结果落 data/raw/）
 *
 * 用法：node src/cli.mjs scan --platform boss --keywords ".NET,C#,上位机"
 */
import { session } from '../core/session.mjs';
import { parseList } from '../platforms/index.mjs';
import { dataPath, writeJSONAtomic, stamp } from '../core/io.mjs';
import { capK } from '../core/salary.mjs';
import { sleep } from '../core/cdp.mjs';

export async function scan(opts = {}) {
  const { platform: pid, keywords, out, capKMin = 25, log = console.log } = opts;
  const kws = parseList(keywords);
  const { cdp, platform } = await session(pid, { tabId: opts.tabId });

  const file = out || dataPath('raw', `${pid}-scan`);
  const all = [];
  const seen = new Set();
  let stopped = null;

  log(`\n=== ${platform.label} 采集 | 关键词 ${kws.length} 个 ===`);
  for (const kw of kws) {
    if (stopped) break;
    log(`--- ${kw} ---`);
    let res;
    try {
      res = platform.VIEWPORT === 'wide' && platform.sortBySalary
        ? await scanWithSort(cdp, platform, kw)
        : await platform.scanKeyword(cdp, kw);
    } catch (e) {
      log(`  !! ${kw} 出错: ${e.message}（跳过该关键词）`);
      continue;
    }
    if (res.stopped) { stopped = res.stopped; log(`  !! 停止：${JSON.stringify(res.stopped)}`); break; }
    if (res.diagnostic) log(`  !! 页面未发现职位卡片：${JSON.stringify(res.diagnostic)}`);

    let items = platform.normalize ? platform.normalize(res.items) : res.items;
    let added = 0;
    for (const j of items) {
      const id = jobId(j);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({ ...j, id, kw, capK: capK(j.sal || j.salary), url: j.url || j.href });
      added++;
    }
    log(`  扫到 ${items.length}，新增 ${added}（累计 ${all.length}）`);
    writeJSONAtomic(file, all);   // 增量落盘：中途挂起也不丢
    await sleep(2500);
  }

  const hit = all.filter((j) => j.capK >= capKMin);
  writeJSONAtomic(file, all);
  log(`\n采集完成：去重 ${all.length} 岗｜上限≥${capKMin}K：${hit.length}`);
  if (stopped) log(`⚠️ 未跑完：${JSON.stringify(stopped)}`);
  cdp.close();
  return { file, total: all.length, hit: hit.length, stopped, items: all };
}

/** 51job：先点「薪资优先」再扫 */
async function scanWithSort(cdp, platform, kw) {
  await platform.scanPage(cdp, kw);
  await platform.sortBySalary(cdp);
  await sleep(2600);
  return platform.scanPage(cdp, kw);
}

function jobId(j) {
  if (j.id) return j.id;
  if (j.jobId) return j.jobId;
  const m = String(j.href || j.url || '').match(/job_detail\/([^.]+)\.html/) || String(j.href || j.url || '').match(/liepin\.com\/(?:a|job)\/(\d+)/) || String(j.href || j.url || '').match(/jobdetail\/(\d+)/);
  return m ? m[1] : (j.href || j.url || '');
}

export const help = 'scan --platform <boss|liepin|job51|zhaopin> [--keywords "a,b"] [--cap 25] [--tab <id>]';
export { stamp };