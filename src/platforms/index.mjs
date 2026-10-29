/**
 * 平台注册表。新增平台只需在此挂载，实现下列接口即可被流水线复用：
 *   id, label, DEFAULT_KEYWORDS, homeUrl?, loginUrl?, searchUrl?(kw), scanKeyword(cdp,kw), normalize?(items),
 *   readJd(cdp), applyOne(cdp,item), probeItem?(cdp,item), guard?(cdp), pace?, VIEWPORT?, chatSupported?
 *   （loginUrl = 登录入口页；login 检测到未登录时新开标签卡打开它）
 */
import * as boss from './boss.mjs';
import * as liepin from './liepin.mjs';
import * as job51 from './job51.mjs';
import * as zhaopin from './zhaopin.mjs';
import * as yupaopin from './yupaopin.mjs';
import { keyByTitleCompany, keyByTitleSalary } from '../core/dedupe.mjs';

export const PLATFORMS = { boss, liepin, job51, zhaopin, yupaopin };

/** 默认优先级：猎聘 + BOSS 为每日主投平台；鱼泡为补充池（苏州本地岗位密度高） */
export const PRIORITY = ['liepin', 'boss', 'zhaopin', 'job51', 'yupaopin'];

/**
 * 各平台去重口径（唯一真源，history / jd / apply 共用）。
 * 岗位 ID 正则统一取自平台适配器的 ID_RE；智联 ID_RE=null，靠卡片指纹去重。
 */
export const DEDUPE = {
  boss: { hostRe: /zhipin\.com/, keyOf: keyByTitleCompany },
  liepin: { hostRe: /liepin\.com/, keyOf: keyByTitleSalary },
  job51: { hostRe: /51job\.com/, keyOf: keyByTitleSalary },
  zhaopin: { hostRe: /zhaopin\.com/, keyOf: (j) => j.cardKey || [j.title, j.sal, j.company].map((x) => String(x || '').trim()).join('|') },
  // 鱼泡 URL 为 /zhaogong/{数字ID}/{随机token}.html —— token 每次变，ID_RE 取纯数字 ID
  yupaopin: { hostRe: /yupao\.com/, keyOf: keyByTitleCompany },
};

/** 取平台去重配置：{ hostRe, keyOf, idRe }，未定义平台直接报错，避免静默用错口径 */
export function dedupeProfile(pid) {
  const p = DEDUPE[pid];
  if (!p) throw new Error(`未定义去重规则: ${pid}`);
  return { ...p, idRe: PLATFORMS[pid]?.ID_RE ?? null };
}

export function getPlatform(id) {
  const p = PLATFORMS[id];
  if (!p) throw new Error(`未知平台: ${id}（可选: ${Object.keys(PLATFORMS).join(', ')}）`);
  return p;
}

export function parseList(str, fallback = []) {
  if (!str) return fallback;
  return String(str).split(/[,|，]/).map((s) => s.trim()).filter(Boolean);
}

/** 每日投递节奏（毫秒区间） */
export function paceOf(platform) {
  const p = platform.pace || { min: 6, max: 12 };
  return { min: p.min * 1000, max: p.max * 1000 };
}