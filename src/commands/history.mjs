/**
 * 命令：history —— 重建跨轮次去重集合
 *
 * 去重集合是控制详情页访问量的关键（猎聘约 120 次访问即触发风控）。
 * 首次使用请加 --from-legacy 从旧的一次性脚本产物回填。
 *
 * 用法：
 *   node src/cli.mjs history --platform boss
 *   node src/cli.mjs history --platform liepin --from-legacy
 */
import { buildHistory, saveHistory, loadHistory, keyByTitleCompany, keyByTitleSalary } from '../core/dedupe.mjs';
import { DATA, ROOT } from '../core/io.mjs';
import path from 'node:path';

const PROFILES = {
  boss: { idRe: /job_detail\/([^.]+)\.html/, hostRe: /zhipin\.com/, keyOf: keyByTitleCompany },
  liepin: { idRe: /liepin\.com\/(?:a|job)\/(\d+)\.shtml/, hostRe: /liepin\.com/, keyOf: keyByTitleSalary },
  job51: { idRe: /51job\.com\/all\/(\d+)\.html/, hostRe: /51job\.com/, keyOf: keyByTitleSalary },
  // 智联卡片内没有职位详情 URL（唯一 <a> 是公司页），故 idRe=null，靠「标题|薪资|公司」指纹去重
  zhaopin: { idRe: null, hostRe: /zhaopin\.com/, keyOf: (j) => j.cardKey || [j.title, j.sal, j.company].map((x) => String(x || '').trim()).join('|') },
};

export async function rebuildHistory(opts = {}) {
  const { log = console.log } = opts;
  const pid = opts.platform || 'boss';
  const p = PROFILES[pid];
  if (!p) throw new Error(`未定义去重规则: ${pid}`);

  const dirs = [DATA.raw, DATA.work, DATA.lists, DATA.logs];
  if (opts.fromLegacy) dirs.push(path.join(ROOT, 'legacy'));

  const history = buildHistory({ dirs, ...p });
  saveHistory(pid, history);
  log(`【${pid}】去重集合：岗位 id ${history.ids.length} 个｜标题键 ${history.keys.length} 个 -> ${path.join(DATA.history, `${pid}-history.json`)}`);
  return history;
}

export const help = 'history --platform <id> [--from-legacy]';
export { loadHistory };