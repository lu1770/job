/**
 * 跨轮次去重：把「已核验 / 已投递 / 已定稿」的岗位聚合成去重集合。
 *
 * 目的有二：
 *  1. 避免重复投递（企业重发岗位会换新 id，故同时用「标题+公司/薪资」兜底）；
 *  2. 把详情页访问量压到最低 —— 猎聘约 121 次详情页访问就会触发风控。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJSON, writeJSONAtomic, listDataFiles } from './io.mjs';

/**
 * 默认只纳入「已核验 / 已投递 / 已定稿清单」类产物。
 * 刻意 **不** 纳入 dropped：被剔除的条目可能只是核验异常（err/slider），
 * 若算进历史会导致这些岗位永远不再重试。
 */
const DEFAULT_INCLUDE = /apply|round|reverify|targets|(^|[-_])jd|jd\d/;
const DEFAULT_EXCLUDE = /scan|candidate|age_|dropped|hist|proc|diag/;

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  visit(node);
  Object.values(node).forEach((v) => walk(v, visit));
}

/**
 * @param {object} o
 * @param {string[]} o.dirs      扫描目录（通常是 data/* 与 legacy 回填目录）
 * @param {RegExp}  [o.include] 文件名白名单
 * @param {RegExp}  [o.exclude] 文件名黑名单
 * @param {RegExp}  o.idRe       从 href/url 中提取岗位 id
 * @param {RegExp}  o.hostRe     href 必须命中（限定本平台）
 * @param {Function} o.keyOf     从条目生成兜底去重键
 */
export function buildHistory({
  dirs = [DATA.raw, DATA.work, DATA.lists, DATA.logs],
  include = DEFAULT_INCLUDE,
  exclude = DEFAULT_EXCLUDE,
  idRe = /\/([0-9a-zA-Z_-]{8,})\.shtml/,
  hostRe = /liepin\.com|zhipin\.com|51job\.com|zhaopin\.com/,
  keyOf = (j) => [(j.title || j.name || '').trim(), (j.sal || j.salary || '').trim()].filter(Boolean).join('||'),
}) {
  const ids = new Set();
  const keys = new Set();
  const perFile = {};

  for (const dir of [].concat(dirs)) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const name of names) {
      if (include && !include.test(name)) continue;
      if (exclude && exclude.test(name)) continue;
      const file = path.join(dir, name);
      let doc;
      try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      let n = 0;
      walk(doc, (j) => {
        // href 可能是相对路径（BOSS 采集产物），url 才是绝对地址 —— 两个都要看
        const href = `${j.href || ''} ${j.url || ''}`;
        if (!hostRe.test(href)) return;
        const m = href.match(idRe);
        if (m) { ids.add(m[1]); n++; }
        const k = keyOf(j);
        if (k && k !== '||') keys.add(k);
      });
      if (n) perFile[path.basename(dir) + '/' + name] = n;
    }
  }
  return { ids: [...ids], keys: [...keys], perFile };
}

export function saveHistory(platform, history) {
  return writeJSONAtomic(path.join(DATA.history, `${platform}-history.json`), {
    platform,
    updated: new Date().toISOString(),
    ...history,
  });
}

export function loadHistory(platform) {
  return readJSON(path.join(DATA.history, `${platform}-history.json`), { ids: [], keys: [] });
}

/** 把历史集合变成查表结构 */
export function historyIndex(history) {
  return { ids: new Set(history.ids || []), keys: new Set(history.keys || []) };
}

/** 判断条目是否已处理过；keyFn 由调用方按平台提供 */
export function isSeen(index, item, keyFn) {
  const id = item.id || (String(item.href || item.url || '').match(/\/([0-9a-zA-Z_-]{8,})\.(?:shtml|html)/) || [])[1];
  if (id && index.ids.has(id)) return true;
  const k = keyFn ? keyFn(item) : '';
  return !!(k && index.keys.has(k));
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