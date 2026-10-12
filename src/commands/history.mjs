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
import { PLATFORMS } from '../platforms/index.mjs';
import path from 'node:path';

// idRe 统一来自平台适配器的 ID_RE（智联 ID_RE=null：卡片内无详情 URL，靠指纹去重）
const PROFILES = {
  boss: { hostRe: /zhipin\.com/, keyOf: keyByTitleCompany },
  liepin: { hostRe: /liepin\.com/, keyOf: keyByTitleSalary },
  job51: { hostRe: /51job\.com/, keyOf: keyByTitleSalary },
  zhaopin: { hostRe: /zhaopin\.com/, keyOf: (j) => j.cardKey || [j.title, j.sal, j.company].map((x) => String(x || '').trim()).join('|') },
  // 鱼泡 URL 为 /zhaogong/{数字ID}/{随机token}.html —— token 每次变，idRe 见 yupaopin.mjs 的 ID_RE
  yupaopin: { hostRe: /yupao\.com/, keyOf: keyByTitleCompany },
};

export async function rebuildHistory(opts = {}) {
  const { log = console.log } = opts;
  const pid = opts.platform || 'boss';
  const p = PROFILES[pid];
  if (!p) throw new Error(`未定义去重规则: ${pid}`);

  const dirs = [DATA.raw, DATA.work, DATA.lists, DATA.logs];
  if (opts.fromLegacy) dirs.push(path.join(ROOT, 'legacy'));

  const history = buildHistory({ dirs, idRe: PLATFORMS[pid]?.ID_RE ?? p.idRe ?? null, ...p });
  saveHistory(pid, history);
  log(`【${pid}】去重集合：岗位 id ${history.ids.length} 个｜标题键 ${history.keys.length} 个 -> ${path.join(DATA.history, `${pid}-history.json`)}`);
  return history;
}

export const help = 'history --platform <id> [--from-legacy]';
export { loadHistory };