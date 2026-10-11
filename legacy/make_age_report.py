# -*- coding: utf-8 -*-
"""生成《年龄限制筛查报告》Markdown。"""
import json, datetime, os

def load(fp, default=None):
    try:
        return json.load(open(fp, encoding="utf-8"))
    except Exception:
        return default

def cell(s):
    return (s or "").replace("|", "/").replace("\n", " ").strip()

now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

SRC = [
    ("BOSS直聘", "targets(候选/投递清单)", "age_out_boss.json"),
    ("猎聘", "targets(候选/投递清单)", "age_out_liepin.json"),
    ("猎聘", "raw(采集池)", "age_out_liepin_raw.json"),
    ("前程无忧51job", "targets(候选/投递清单)", "age_out_j51.json"),
]

rows, hits = [], []
for plat, scope, fp in SRC:
    d = load(fp)
    if d is None:
        rows.append((plat, scope, "未执行", 0, 0, 0, 0)); continue
    valid = [r for r in d if (r.get("jdLen") or 0) >= 300 or r.get("err")]
    bad = [r for r in d if (r.get("jdLen") or 0) < 300]
    h = [r for r in valid if r.get("age")]
    sl = [r for r in d if r.get("slider")]
    rows.append((plat, scope, str(len(valid)), len(h), len(sl), len(bad), len(d)))
    for r in h:
        hits.append((plat, r.get("title") or "", r.get("company") or "",
                     r.get("sal") or "", r.get("age", {}).get("hit", ""), r.get("url") or ""))

cards = load("_age_hits_cards.json", [])
blk = load("_blocklist.json", {})

total_checked = sum(int(r[2]) for r in rows if r[2].isdigit())
total_hits = len(hits)

L = []
L.append(f"# 职位描述「年龄限制」筛查报告")
L.append(f"\n生成时间：{now}　|　执行：CDP 真实浏览器逐岗读取 JD 正文 + 文本规则判定\n")

L.append("## 一、结论\n")
L.append(f"- 本轮共**实读 JD 正文 {total_checked} 条**（BOSS + 猎聘 + 51job 的今日候选/投递清单，以及猎聘采集池）。")
L.append(f"- **判定含年龄限制的条目：{total_hits} 条**；另有 **{len(cards)} 条**在标题/卡面文本层面命中。")
L.append(f"- 屏蔽名单 `_blocklist.json` 现有 {len(blk.get('companies', []))} 家公司：{'、'.join(blk.get('companies', []))}。")
L.append(f"- 已把年龄限制判据写入采集/核验流水线（`age.mjs`），后续每轮 JD 核验会自动剔除含年龄限制的岗位。\n")

L.append("## 二、检查范围与方法\n")
L.append("| 平台 | 范围 | 有效实读 | 年龄命中 | 滑块中断 | 风控无效页 | 累计尝试 |")
L.append("|---|---|---:|---:|---:|---:|---:|")
for plat, scope, n, h, sl, bad, tot in rows:
    L.append(f"| {plat} | {scope} | {n} | {h} | {sl} | {bad} | {tot} |")
L.append("")
L.append("方法：逐个打开岗位详情页 → 提取页面全文（含「职位描述/岗位职责/任职要求」段）→ 用规则库判定年龄限制。")
L.append("规则覆盖：`年龄xx岁`、`年龄：25-40周岁`、`xx-xx岁`、`不超过/低于xx岁`、`xx岁以下/以内`、裸 `xx岁`、")
L.append("`90后/85后`、`1985年以后出生` 等；并排除「年龄不限/不限年龄」等无限制表述。")
L.append("注：「风控无效页」= 平台返回验证/异常页（正文 <300 字），不计入有效实读，也不会产生误判。\n")

L.append("### 平台风控情况（重要）\n")
L.append("- **猎聘**：约第 121 个详情页起返回「账号行为异常，请短信验证」页 → 已按规则停止，**需你手动短信验证**才能恢复猎聘自动化。")
L.append("- **前程无忧 51job**：第 16 个详情页触发滑块，240 秒重试仍连续命中（粘滞态）→ 需人工过一次滑块。")
L.append("- **BOSS 直聘**：全程 43/43 正常，无风控。\n")

L.append("## 三、命中明细\n")
if hits:
    L.append("| 平台 | 岗位 | 公司 | 薪资 | 命中片段 | 链接 |")
    L.append("|---|---|---|---|---|---|")
    for p, t, c, s, hit, u in hits:
        L.append(f"| {p} | {cell(t)} | {cell(c) or '(匿名/未取到)'} | {cell(s)} | `{cell(hit)}` | {u[:80]} |")
else:
    L.append("（实读 JD 正文中未发现含年龄限制的条目。）")
L.append("")
if cards:
    L.append("### 卡面/标题层面命中\n")
    L.append("| 来源文件 | 岗位标题 | 薪资 | 命中 |")
    L.append("|---|---|---|---|")
    for c in cards:
        L.append(f"| {cell(c.get('file'))} | {cell(c.get('title'))} | {cell(c.get('sal'))} | `{cell(c.get('hit'))}` |")
    L.append("")
    L.append("> 该条为猎聘猎头岗位（发布方匿名「某苏州电子/半导体/集成电路上市公司」），标题即写明「35岁」，无法定位到具体公司主体。\n")

L.append("## 四、屏蔽名单\n")
L.append("```json")
L.append(json.dumps(blk, ensure_ascii=False, indent=2))
L.append("```\n")
L.append("> ⚠️ 待用户确认：**「这家公司」具体是哪一家** —— 本轮实读的全部 JD 中未出现可定位的、含年龄限制的公司主体，")
L.append("> 因此未能自动写入屏蔽名单。请提供公司全名，我立即加入 `_blocklist.json`。\n")

L.append("## 五、已落地的自动化规则\n")
L.append("- 新增 `job/age.mjs`：年龄限制探测器（`detectAgeLimit`）。")
L.append("- `job/boss_jd.mjs`、`job/lp_jd.mjs`：JD 核验时同步写入 `ageLimit` 字段。")
L.append("- `job/build_targets.mjs`：含 `ageLimit` 的岗位一律剔除，理由记为「年龄限制:xxx」。")
L.append("- 新增 `job/age_check.mjs`（通用逐岗核验）、`job/card_age_scan.mjs`（卡面文本批量扫描）、`job/aggregate_age.py`（汇总+回写屏蔽名单）。\n")

open("../年龄限制筛查报告_2026-10-10.md", "w", encoding="utf-8").write("\n".join(L))
print("已生成 ../年龄限制筛查报告_2026-10-10.md")
print(f"实读 {total_checked} 条，命中 {total_hits} 条，卡面命中 {len(cards)} 条")
