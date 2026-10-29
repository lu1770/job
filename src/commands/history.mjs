/**
 * 命令：history —— 重建跨轮次去重台账
 *
 * 台账是控制详情页访问量的关键（猎聘约 120 次访问即触发风控），
 * 也是「已投递岗位自动跳过」的数据源：只统计 apply/verify 日志里 ok / already 的行，
 * 失败行不进台账，避免被永久跳过。
 *
 * 首次使用请加 --from-legacy 从旧的一次性脚本产物回填。
 *
 * 用法：
 *   node src/cli.mjs history --platform boss
 *   node src/cli.mjs history --platform liepin --from-legacy
 */
import { buildHistory, saveHistory, loadHistory } from '../core/dedupe.mjs';
import { DATA, ROOT } from '../core/io.mjs';
import { dedupeProfile } from '../platforms/index.mjs';
import path from 'node:path';

export async function rebuildHistory(opts = {}) {
  const { log = console.log } = opts;
  const pid = opts.platform || 'boss';
  const p = dedupeProfile(pid);

  const dirs = [DATA.raw, DATA.work, DATA.lists, DATA.logs];
  if (opts.fromLegacy) dirs.push(path.join(ROOT, 'legacy'));

  const history = buildHistory({ dirs, idRe: p.idRe, hostRe: p.hostRe, keyOf: p.keyOf, prefix: pid });
  saveHistory(pid, history);
  log(`【${pid}】已投递 ${history.applied} 个岗位（去重后；日志行 ${history.appliedRows} 条）`
    + `｜台账 id ${history.ids.length} 个｜标题键 ${history.keys.length} 个`
    + `｜失败行已排除 ${history.failed} 条 -> ${path.join(DATA.history, `${pid}-history.json`)}`);
  return history;
}

export const help = 'history --platform <id> [--from-legacy]';
export { loadHistory };
