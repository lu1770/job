/**
 * 多轮刷新采集：反复执行单轮扫描，按 key 合并去重。
 *
 * 为什么：搜索/推荐结果每次加载不完全相同（BOSS 实测两轮间 91% 重叠，
 * 3 轮合并约 1.10x 增量）—— 重复的自动去重，不重复的就是扩出来的池子。
 * 某轮零新增即提前结束：结果集已稳定，再刷也是同样内容，不空耗请求（风控铁律）。
 *
 * @param {(round:number)=>Promise<{items:Array, stopped?:object, diagnostic?:object}>} scanOnce 单轮扫描
 * @param {object} o
 * @param {number} [o.refresh=1]  刷新轮数（1 = 关闭，只扫一轮）
 * @param {(item:object)=>string} o.keyOf  去重键（各平台：岗位 id / 指纹）
 * @param {number} [o.pauseMs=4100] 轮间间隔 —— 必须真有间隔，别把请求打成突发
 */
import { sleep } from './cdp.mjs';

export async function multiScan(scanOnce, { refresh = 1, keyOf, pauseMs = 4100 }) {
  const seen = new Map();
  let stopped = null, pass = 0, lastDiag = null;
  const stats = [];

  for (let r = 0; r < Math.max(1, refresh); r++) {
    const res = await scanOnce(r);
    if (res.diagnostic) lastDiag = res.diagnostic;
    if (res.stopped) { stopped = res.stopped; break; }

    let added = 0;
    for (const j of res.items) {
      const k = keyOf(j);
      if (!k || seen.has(k)) continue;
      seen.set(k, j);
      added++;
    }
    pass++;
    stats.push({ pass: r + 1, got: res.items.length, added });
    if (added === 0 && r > 0) break;
    if (r < refresh - 1) await sleep(pauseMs);
  }

  // 一轮都没采到时透传单轮诊断（如 no_cards），否则只报刷新统计
  const diagnostic = { refreshes: pass, stats, uniq: seen.size };
  if (!seen.size && lastDiag && lastDiag.reason) Object.assign(diagnostic, lastDiag);
  return { items: [...seen.values()], stopped, diagnostic };
}
