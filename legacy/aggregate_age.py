# -*- coding: utf-8 -*-
"""汇总各平台「年龄限制」核验结果 → _age_blocked.json，并把命中公司写入 _blocklist.json。"""
import json, os, re

OUTS = {"boss": "age_out_boss.json", "liepin": "age_out_liepin.json",
        "liepin-raw": "age_out_liepin_raw.json", "j51": "age_out_j51.json"}

def load(fp):
    try:
        return json.load(open(fp, encoding="utf-8"))
    except Exception:
        return None

def base(u):
    return (u or "").split("?")[0]

# ---- 猎聘 / 51job 公司名补全 ----
co_map = {}
# 猎聘：从 parts 里取公司名
for fp in ["lp_jd.json", "lp_jd2.json", "lp_targets2.json", "lp_scan_raw.json", "lp_scan_raw2.json"]:
    d = load(fp)
    if not isinstance(d, list):
        continue
    for r in d:
        if not isinstance(r, dict):
            continue
        u = base(r.get("href") or r.get("url"))
        parts = r.get("parts") or []
        co = ""
        if isinstance(parts, list) and len(parts) >= 8:
            cand = str(parts[7]).strip()
            if cand and not re.fullmatch(r"[\d\-.kK万亿薪年月经验学历不限本科大专硕士博士]+", cand):
                co = cand
        if not co:
            txt = r.get("txt") or ""
            m = re.search(r"(?:本科|大专|硕士|博士|学历不限|经验不限)\s*\|\s*([^|\n]{2,40}?)\s*\|", txt)
            if m:
                co = m.group(1).strip()
        if u and co:
            co_map.setdefault(u, co)
# 51job
d = load("j51_final.json")
if isinstance(d, list):
    for r in d:
        jid = str(r.get("jobId") or "")
        if jid:
            co_map["https://jobs.51job.com/all/%s.html" % jid] = r.get("comp") or ""

blocked = []
for plat, fp in OUTS.items():
    d = load(fp)
    if not isinstance(d, list):
        print(f"  ({fp} 缺失，跳过)")
        continue
    for r in d:
        if not isinstance(r, dict):
            continue
        age = r.get("age")
        if not age:
            continue
        u = base(r.get("url"))
        co = r.get("company") or co_map.get(u, "") or ""
        blocked.append({
            "platform": plat,
            "title": r.get("title") or r.get("jdTitle") or "",
            "company": co,
            "sal": r.get("sal") or "",
            "url": r.get("url") or "",
            "hit": age.get("hit"),
            "kind": age.get("kind"),
            "ctx": age.get("ctx"),
        })

json.dump(blocked, open("_age_blocked.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"年龄限制条目：{len(blocked)}")

# ---- 更新屏蔽名单 ----
bl = load("_blocklist.json") or {"companies": []}
companies = bl.get("companies") or []
added = []
for b in blocked:
    c = (b["company"] or "").strip()
    if not c or c in companies:
        continue
    # 过短/占位名不入库
    if len(c) < 3 or re.fullmatch(r"某.{0,20}(公司|企业)", c):
        continue
    companies.append(c)
    added.append(c)
bl["companies"] = companies
bl["updated"] = "2026-10-10"
json.dump(bl, open("_blocklist.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"新增屏蔽公司 {len(added)} 家：{added}")

print("\n=== 命中明细 ===")
for b in blocked:
    print(f"[{b['platform']}] {b['title']} | {b['company'] or '(公司名未取到)'} | {b['sal']} | 「{b['hit']}」{b['url'][:70]}")
