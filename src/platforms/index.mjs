/**
 * 平台注册表。新增平台只需在此挂载，实现下列接口即可被流水线复用：
 *   id, label, DEFAULT_KEYWORDS, searchUrl?(kw), scanKeyword(cdp,kw), normalize?(items),
 *   readJd(cdp), applyOne(cdp,item), probeItem?(cdp,item), guard?(cdp), pace?, VIEWPORT?, chatSupported?
 */
import * as boss from './boss.mjs';
import * as liepin from './liepin.mjs';
import * as job51 from './job51.mjs';
import * as zhaopin from './zhaopin.mjs';

export const PLATFORMS = { boss, liepin, job51, zhaopin };

/** 默认优先级：猎聘 + BOSS 为每日主投平台 */
export const PRIORITY = ['liepin', 'boss', 'zhaopin', 'job51'];

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