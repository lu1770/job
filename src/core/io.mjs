/**
 * 数据访问层：代码与数据严格分离。
 * 所有运行产物落在 data/ 下，按 raw / work / lists / logs / history 分类。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const CONFIG_DIR = path.join(ROOT, 'config');
export const REPORTS_DIR = path.join(ROOT, 'reports');

export const DATA = {
  root: path.join(ROOT, 'data'),
  raw: path.join(ROOT, 'data', 'raw'),      // 采集原始结果
  work: path.join(ROOT, 'data', 'work'),    // 中间产物（候选 / JD 核验）
  lists: path.join(ROOT, 'data', 'lists'),  // 最终投递清单
  logs: path.join(ROOT, 'data', 'logs'),    // 逐条落盘日志
  history: path.join(ROOT, 'data', 'history'), // 去重集合
};

export function ensureDirs() {
  for (const d of [CONFIG_DIR, REPORTS_DIR, ...Object.values(DATA)]) fs.mkdirSync(d, { recursive: true });
}

export function ts(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function stamp() { return ts(); }

/** data/<bucket>/<name>-<stamp>.json */
export function dataPath(bucket, name, withStamp = true) {
  const dir = DATA[bucket] || DATA.work;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, withStamp ? `${name}-${stamp()}.json` : `${name}.json`);
}

export function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return file;
}

/** 原子落盘：先写临时文件再 rename，避免进程被杀导致半截 JSON */
export function writeJSONAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
  return file;
}

/** 增量落盘器：循环体内反复调用，保证中途异常也不丢已完成条目 */
export function createSink(file) {
  let rows = readJSON(file, []) || [];
  return {
    get rows() { return rows; },
    push(row) { rows.push(row); writeJSONAtomic(file, rows); return row; },
    flush() { writeJSONAtomic(file, rows); return file; },
  };
}

export function readConfig(name, fallback = {}) {
  return readJSON(path.join(CONFIG_DIR, name), fallback) || fallback;
}

export function listDataFiles(bucket = 'logs') {
  const dir = DATA[bucket] || bucket;
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)); }
  catch { return []; }
}

/** 最新一个产物文件（按文件名内嵌时间戳排序） */
export function latestDataFile(bucket, prefix = '') {
  const files = listDataFiles(bucket).filter((f) => path.basename(f).startsWith(prefix)).sort();
  return files.length ? files[files.length - 1] : null;
}