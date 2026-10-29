/**
 * 跨轮次去重台账：把「已投递 / 已核验 / 已定稿」的岗位聚合成去重集合。
 *
 * 目的有二：
 *  1. 避免重复投递（企业重发岗位会换新 id，故同时用「标题+公司/薪资」兜底）；
 *  2. 把详情页访问量压到最低 —— 猎聘约 121 次详情页访问就会触发风控。
 *
 * 注意：投递日志里 **只有 ok / already 才算已投递**，失败/跳过行绝不能进台账，
 * 否则这批岗位会被永久跳过、不再重试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJSON, writeJSONAtomic, listDataFiles } from './io.mjs';

/** 投递成功（含「已沟通」）的结果码 —— 唯一可以写进台账的投递结果 */
export const APPLIED_RESULTS = new Set(['ok', 'already']);

/**
 * 默认纳入「已投递 / 已核验 / 已定稿清单」类产物。
 * 刻意 **不** 纳入 dropped：被剔除的条目可能只是核验异常（err/slider），
 * 若算进历史会导致这些岗位永远不再重试。
 */
const DEFAULT_INCLUDE = /apply|retry|verify|round|targets|(^|[-_])jd|jd\d/;
const DEFAULT_EXCLUDE = /scan|candidate|age_|dropped|hist|proc|diag/;

/** 通用 ID 兜底正则（调用方没给平台 ID_RE 时使用） */
const GENERIC_ID_RE = /\/([0-9a-zA-Z_-]{8,})\.(?:shtml|html)/;

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  visit(node);
  Object.values(node).forEach((v) => walk(v, visit));
}

/**
 * 从条目提取岗位 id（全项目唯一实现，scan / buildHistory / isSeen / apply 共用）。
 * 优先级：条目自带 id / jobId → 平台 ID_RE 从 href/url 提取。
 * 提不到返回 ''，交给业务指纹兜底 —— 绝不拿半截 URL 当 id。
 */
export function jobIdOf(item, idRe = GENERIC_ID_RE) {
  const own = item && (item.id || item.jobId);
  if (own !== undefined && own !== null && String(own).trim() && !/^https?:/i.test(String(own))) return String(own).trim();
  const href = String((item && (item.href || item.url)) || '');
  if (!href || !idRe) return '';
  const m = href.match(idRe);
  return m && m[1] ? m[1] : '';
}

/**
 * @param {object} o
 * @param {string[]} o.dirs      扫描目录（通常是 data/* 与 legacy 回填目录）
 * @param {RegExp}  [o.include] 文件名白名单
 * @param {RegExp}  [o.exclude] 文件名黑名单
 * @param {RegExp}  [o.idRe]     从 href/url 中提取岗位 id；传 null 表示该平台无 URL（仅靠 keyOf 去重）
 * @param {RegExp}  [o.hostRe]   href 必须命中（限定本平台）
 * @param {Function} o.keyOf     从条目生成兜底去重键
 * @param {boolean} [o.appliedOnly] 带 result 的投递行只收 ok/already（默认 true）
 */
export function buildHistory({
  dirs = [DATA.raw, DATA.work, DATA.lists, DATA.logs],
  include = DEFAULT_INCLUDE,
  exclude = DEFAULT_EXCLUDE,
  idRe = GENERIC_ID_RE,
  hostRe = /liepin\.com|zhipin\.com|51job\.com|zhaopin\.com|yupao\.com/,
  keyOf = (j) => [(j.title || j.name || '').trim(), (j.sal || j.salary || '').trim()].filter(Boolean).join('||'),
  appliedOnly = true,
  prefix = '',
}) {
  const ids = new Set();
  const keys = new Set();
  const appliedSet = new Set();
  const perFile = {};
  let appliedRows = 0;
  let failed = 0;

  for (const dir of [].concat(dirs)) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const name of names) {
      // 每平台台账只吃自己的产物；旧版无平台前缀的文件仍保留，避免回填失效
      if (prefix && !name.startsWith(`${prefix}-`) && /^(boss|liepin|job51|zhaopin|yupaopin)-/.test(name)) continue;
      if (include && !include.test(name)) continue;
      if (exclude && exclude.test(name)) continue;
      const file = path.join(dir, name);
      let doc;
      try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      let n = 0;
      walk(doc, (j) => {
        const href = `${j.href || ''} ${j.url || ''}`;
        // 只统计本平台产物：带绝对 URL 但域名不符，说明是别的平台的日志/清单
        if (hostRe && /https?:/i.test(href) && !hostRe.test(href)) return;
        const id = jobIdOf(j, idRe);
        const k = keyOf(j) || '';
        // 带 result 的是投递日志行：失败/跳过不写台账，避免永久跳过
        if ('result' in j) {
          if (!APPLIED_RESULTS.has(j.result)) {
            if (appliedOnly) { failed++; return; }
          } else {
            appliedRows++;
            // 同一岗位可能被多轮日志重复记为 already，按 id/指纹去重后才是真实已投递数
            appliedSet.add(id || k || `row:${appliedRows}`);
          }
        }
        if (id) { ids.add(id); n++; }
        if (k && k !== '||' && k !== '|') keys.add(k);
      });
      if (n) perFile[path.basename(dir) + '/' + name] = n;
    }
  }
  return { ids: [...ids], keys: [...keys], perFile, applied: appliedSet.size, appliedRows, failed };
}

export function saveHistory(platform, history) {
  return writeJSONAtomic(path.join(DATA.history, `${platform}-history.json`), {
    platform,
    updated: new Date().toISOString(),
    ...history,
  });
}

export function loadHistory(platform) {
  return readJSON(path.join(DATA.history, `${platform}-history.json`), { ids: [], keys: [], applied: 0 });
}

/** 把历史集合变成查表结构 */
export function historyIndex(history) {
  return { ids: new Set(history.ids || []), keys: new Set(history.keys || []) };
}

/** 判断条目是否已处理过；keyFn / idRe 由调用方按平台提供 */
export function isSeen(index, item, keyFn, idRe) {
  const id = jobIdOf(item, idRe);
  if (id && index.ids.has(id)) return true;
  const k = keyFn ? keyFn(item) : '';
  return !!(k && index.keys.has(k));
}

/**
 * 增量台账写入器：投递成功一条就落一次盘，
 * 进程中途被杀也不会丢已投递记录。之后 jd/apply 会自动跳过这些岗位。
 */
export function createHistoryRecorder(platform, keyFn, idRe) {
  const loaded = loadHistory(platform);
  const ids = new Set(loaded.ids || []);
  const keys = new Set(loaded.keys || []);
  let applied = Number(loaded.applied) || 0;
  let added = 0;
  const save = () => writeJSONAtomic(path.join(DATA.history, `${platform}-history.json`), {
    platform, updated: new Date().toISOString(), applied,
    ids: [...ids], keys: [...keys],
  });
  return {
    get added() { return added; },
    get applied() { return applied; },
    add(item) {
      const id = jobIdOf(item, idRe);
      const k = keyFn ? keyFn(item) : '';
      if (id) ids.add(id);
      if (k && k !== '||' && k !== '|') keys.add(k);
      applied++; added++;
      save(); // 逐条落盘
      return this;
    },
    flush: save,
    snapshot() { return { ids: [...ids], keys: [...keys], applied }; },
  };
}

/** 通用 keyFn：标题 + 薪资（BOSS 也可换成 标题 + 公司） */
export const keyByTitleSalary = (j) => [(j.title || j.name || '').trim(), (j.sal || j.salary || '').trim()].filter(Boolean).join('||');
export const keyByTitleCompany = (j) => [(j.title || j.name || '').trim(), (j.company || '').trim()].filter(Boolean).join('||');

/** 统计：某目录下共有多少产物（诊断用） */
export function dataStats() {
  const out = {};
  for (const [k, dir] of Object.entries(DATA)) {
    out[k] = (() => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length; } catch { return 0; } })();
  }
  return out;
}

export { listDataFiles };
