# -*- coding: utf-8 -*-
"""从今日的候选/目标/投递清单中，汇总出需要做「年龄限制」核验的岗位集合（去重）。"""
import json, os

BOSS = ["boss_targets_today.json", "boss_targets_b.json", "boss_jd_todo.json",
        "boss_jd_todo_b.json", "boss_apply_run_1110.json", "boss_apply_run_b.json"]
LP   = ["lp_targets_today.json", "lp_targets2.json", "lp_apply_run_1110.json",
        "lp_apply_run2.json", "lp_jd.json", "lp_jd2.json"]
J51  = ["j51_final.json"]

def load(fp):
    try:
        return json.load(open(fp, encoding="utf-8"))
    except Exception:
        return []

def rows(d):
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        return d.get("list") or d.get("records") or d.get("rows") or []
    return []

def boss_item(r):
    url = r.get("url") or r.get("href") or ""
    if url.startswith("/"):
        url = "https://www.zhipin.com" + url
    if not url:
        return None
    return {"platform": "boss", "id": r.get("id") or url,
            "url": url, "title": r.get("name") or r.get("jdTitle") or "",
            "company": r.get("company") or "", "sal": r.get("sal") or ""}

def lp_item(r):
    url = r.get("url") or r.get("href") or ""
    if not url:
        return None
    return {"platform": "liepin", "id": r.get("id") or url,
            "url": url, "title": (r.get("title") or "").split("|")[0].strip(),
            "company": "", "sal": r.get("sal") or ""}

def j51_item(r):
    jid = str(r.get("jobId") or "")
    if not jid:
        return None
    return {"platform": "51job", "id": jid,
            "url": f"https://jobs.51job.com/all/{jid}.html",
            "title": r.get("title") or "", "company": r.get("comp") or "",
            "sal": r.get("sal") or ""}

def build(files, mapper):
    seen, out = set(), []
    for f in files:
        for r in rows(load(f)):
            if not isinstance(r, dict):
                continue
            it = mapper(r)
            if not it:
                continue
            key = it["url"].split("?")[0]
            if key in seen:
                continue
            seen.add(key)
            out.append(it)
    return out

out = {
    "boss": build(BOSS, boss_item),
    "liepin": build(LP, lp_item),
    "j51": build(J51, j51_item),
}
for k, v in out.items():
    json.dump(v, open(f"age_in_{k}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"age_in_{k}.json : {len(v)}")
print("TOTAL", sum(len(v) for v in out.values()))
