// 对「已采集的卡片/标题文本」做年龄限制扫描（不联网）。
// 覆盖所有 scan/candidate/target 文件里的 title/name/txt/parts/excerpt/panelTitle 字段。
import fs from 'node:fs';
import { detectAgeLimit } from './age.mjs';

const FILES = [
  'boss_scan_today.json', 'boss_scan_raw.json', 'boss_candidates_today.json', 'boss_targets_today.json',
  'boss_targets_b.json', 'boss_jd_today.json', 'boss_jd_b.json', '_dropped_boss.json', 'boss_round2_log.json',
  'lp_scan_raw.json', 'lp_scan_raw2.json', 'lp_candidates2.json', 'lp_candidates2_fresh.json',
  'lp_targets_today.json', 'lp_targets2.json', 'lp_jd.json', 'lp_jd2.json', 'lp_round2_log.json',
  'j51_all.json', 'j51_targets.json', 'j51_final.json', 'j_apply_log2.json',
  'zl_run_log.json', 'zl_run_log2.json', 'zl_run_log3.json', 'zl_verify.json', 'zl_dry.json',
];
const FIELDS = ['name', 'title', 'txt', 'excerpt', 'panelTitle', 'jdTitle'];
const TEXTARR = ['parts'];

function rows(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return d.candidates || d.fresh || d.list || d.records || [];
  return [];
}

const hits = [];
for (const f of FILES) {
  let d;
  try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const r of rows(d)) {
    if (!r || typeof r !== 'object') continue;
    let text = '';
    for (const k of FIELDS) if (r[k]) text += ' | ' + r[k];
    for (const k of TEXTARR) if (Array.isArray(r[k])) text += ' | ' + r[k].join(' | ');
    const age = detectAgeLimit(text);
    if (age) {
      hits.push({ file: f, title: r.name || r.title || '', company: r.company || r.comp || '',
        sal: r.sal || '', hit: age.hit, kind: age.kind, url: r.url || r.href || '' });
    }
  }
}

fs.writeFileSync('_age_hits_cards.json', JSON.stringify(hits, null, 1));
console.log(`卡片/标题文本年龄限制命中：${hits.length} 条`);
for (const h of hits) console.log(`- [${h.file}] ${h.title} | ${h.company} | ${h.sal} | 「${h.hit}」`);
