# 旧脚本归档（legacy）

2026-10-10 之前的 88 个一次性脚本已全部归档到本目录，**功能已合并进 `src/`**，此处仅作历史留档与行为追溯用，不再维护、不会被 `src/cli.mjs` 加载。

## 合并映射

| 旧脚本（group: n 个） | 新归属 |
|---|---|
| `cdp.mjs` `jlib.mjs` `jeval.mjs` `realclick.mjs` `exp_*` `probe_emu` `emu_focus` `br_restore` `restore_win` `win_diag` `probe_vp` `nav_chat` `open` `refresh_scan` (16) | `src/core/cdp.mjs` + `src/core/session.mjs` |
| `boss_scan` `boss_scan2` (2) | `src/platforms/boss.mjs` → `scanKeyword()` |
| `liepin_collect` (1) | `src/platforms/liepin.mjs` → `scanKeyword()` |
| `j51_scan` `job51_collect` `insp_j51*` `probe_j51_keys` `j51_diag` `j51_state` (8) | `src/platforms/job51.mjs` |
| `zl_run` `zhilian_apply` `zl_records` `zl_city_probe` `insp_zl` (5) | `src/platforms/zhaopin.mjs` |
| `boss_apply` `boss_apply_r4` `boss_apply_retry6` `boss_apply_retry6b` `boss_realclick_test` (5) | `src/commands/apply.mjs` + `platforms/*.applyOne()`（`--retry-logs` 覆盖重投） |
| `liepin_apply` `lp_realclick` (2) | 同上 |
| `job51_apply` (1) | 同上 |
| `boss_jd` `lp_jd` `age_check` (3) | `src/commands/jd.mjs` + `src/core/criteria.mjs`(techFlags/age) |
| `age` `card_age_scan` (2) | `src/core/age.mjs` |
| `boss_filter` `lp_filter` `build_targets` `mk_boss_targets_r4` `mk_lp_targets` (5) | `src/commands/targets.mjs` + `config/criteria.json` |
| `blocklist` (1) | `config/blocklist.json` + `src/core/criteria.mjs` |
| `boss_chat` `boss_unread_check` `boss_unread_v2` `boss_unread_v3` `boss_read1` `boss_probe_one` `boss_find` (7) | `src/platforms/boss.mjs` → `listConversations()` / `readConversation()` + `src/commands/chat.mjs` |
| `boss_send` `boss_send_one` (2) | `platforms/boss.mjs` → `sendMessage()`（批量等价于单条） |
| `boss_conv_check` `boss_probe_apply` `boss_btn_probe` (3) | `platforms/*` → `probeItem()` + `commands/apply.mjs --probe` |
| `lp_chat` `lp_chat2` `lp_chat3` `lp_ball` `lp_open_diag` `lp_btn_probe` `lp_diag` (7) | `src/platforms/liepin.mjs` → `openChat/listConversations/readConversation`（**采用 lp_chat3 的聊天窗限定读取**） |
| `lp_send` (1) | `platforms/liepin.mjs` → `sendMessage()` |
| `build_hist` `build_hist_lp` (2) | `src/commands/history.mjs` + `src/core/dedupe.mjs` |
| `verify_login` `probe_login` `probe_state` `p_login` (4) | `src/commands/login.mjs` + `platforms/*.loginProbe()` |
| `_lp_tab` `insp_lp_card` `insp_boss` `insp_*` `probe_*` `dec_test` `expr_*` (18) | 一次性探针，无对应实现，按需重写 |

## 数据迁移

原根目录下 76 个 JSON 已按语义归位：

- `data/raw/` —— 采集原始结果（`*scan*`）
- `data/work/` —— JD 核验 / 候选 / 年龄专项中间产物
- `data/lists/` —— 最终投递清单（`*targets*`）
- `data/logs/` —— 投递与沟通逐条日志
- `data/history/` —— 去重集合（`*-history.json`）

兼容说明：`targets` 命令同时识别旧字段 `f.csharp` 与新字段 `flags.dotnet`，因此历史产物可直接复用（已验证：用 `data/work/boss_jd_today.json` 重跑得到 91 条，与旧脚本结果完全一致）。