// 公司屏蔽名单（用户指定）：_blocklist.json
// 用法：import { isBlocked } from './blocklist.mjs';
import fs from 'node:fs';

let LIST = [];
try {
  const j = JSON.parse(fs.readFileSync('_blocklist.json', 'utf8'));
  LIST = (j.companies || []).filter(Boolean);
} catch {}

export function blockedCompany(name) {
  const s = (name || '').toString();
  if (!s) return null;
  const hit = LIST.find((c) => s.includes(c) || c.includes(s));
  return hit || null;
}

export function isBlocked(name) {
  return !!blockedCompany(name);
}

export function blocklist() {
  return LIST.slice();
}
