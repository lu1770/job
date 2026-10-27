/**
 * 命令：daily —— 每日投递全流程编排
 *
 * 顺序：登录核验 → 采集 → JD 核验 → 生成清单 → 投递 → 复核 → 会话巡检 → 关键词排行
 * 任一平台触发风控/额度限制即跳过该平台，继续其他平台（用户口径）。
 *
 * 用法：node src/cli.mjs daily --platform liepin,boss [--keywords ".NET,C#"]
 */
import { login } from './login.mjs';
import { scan } from './scan.mjs';
import { jd } from './jd.mjs';
import { targets } from './targets.mjs';
import { apply, verify } from './apply.mjs';
import { chatRead } from './chat.mjs';
import { keywords } from './keywords.mjs';
import { PRIORITY, parseList, getPlatform } from '../platforms/index.mjs';
import { openTab, sleep } from '../core/cdp.mjs';
import { writeJSONAtomic, DATA } from '../core/io.mjs';
import path from 'node:path';

export async function daily(opts = {}) {
  const { log = console.log, skipChat = false, skipLogin = false } = opts;
  const pids = parseList(opts.platform, PRIORITY.slice(0, 2)); // 默认只跑猎聘 + BOSS
  const summary = { startedAt: new Date().toISOString(), platforms: {} };
  const scanAll = [];
  const runDay = (() => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  })();

  if (!skipLogin) {
    log('\n########## 0. 登录 / 环境核验 ##########');
    const env = await login({ ...opts, platform: pids });
    summary.env = env;
    if (!env.cdp) return summary;
  }

  for (const pid of pids) {
    log(`\n########## ${pid} ##########`);
    // 本平台专用标签：采集→核验→投递→复核→巡检全部在这同一张标签上执行，
    // 与其他平台/其他并发运行物理隔离，杜绝共享浏览器串台。
    // （用户显式传 --tab 时尊重之，不另开。）
    const P = { platform: pid };
    if (opts.tabId) P.tabId = opts.tabId;
    else {
      const tab = await openTab(getPlatform(pid).homeUrl || 'about:blank');
      await sleep(2000);
      P.tabId = tab.id;
    }
    try {
      if (!skipLogin && summary.env?.platforms?.[pid]?.ok === false) {
        log(`跳过 ${pid}：未登录`);
        summary.platforms[pid] = { skipped: 'not_logged_in' };
        continue;
      }
      log('\n--- 1. 采集 ---');
      const s = await scan({ ...opts, ...P });
      if (s.stopped && !s.total) { summary.platforms[pid] = { stopped: s.stopped }; continue; }
      scanAll.push(...(s.keywords || []).map((k) => ({ platform: pid, ...k })));

      log('\n--- 2. JD 核验 ---');
      const j = await jd({ ...opts, ...P, in: s.file });

      log('\n--- 3. 生成清单 ---');
      const t = await targets({ ...opts, ...P, in: j.file, show: false });

      log('\n--- 4. 投递 ---');
      const a = await apply({ ...opts, ...P, in: t.file });

      log('\n--- 5. 复核 ---');
      const v = await verify({ ...opts, ...P, in: t.file });

      let chat = null;
      if (!skipChat) {
        log('\n--- 6. 会话巡检（只读）---');
        chat = await chatRead({ ...opts, ...P, unreadOnly: true, max: 20 });
      }

      summary.platforms[pid] = {
        scan: { file: s.file, total: s.total, hit: s.hit, keywords: s.keywords },
        jd: { file: j.file, count: j.count, stopped: j.stopped },
        targets: { file: t.file, count: t.keep.length },
        apply: { ok: a.ok, already: a.already, skipped: a.skipped, unknown: a.unknown, fail: a.fail, stopped: a.stopped, quota: a.quota, log: a.log },
        verify: { ok: v.ok, already: v.already, skipped: v.skipped, unknown: v.unknown, fail: v.fail },
        chat: chat ? { needReply: (chat.needReply || []).length } : null,
      };
    } catch (e) {
      log(`❌ ${pid} 流程异常：${e.message}`);
      summary.platforms[pid] = { error: e.message };
    }
  }

  // 末尾只读分析：汇总当日所有平台的 JD 落盘，出关键词排行报告。
  // 失败不影响投递主流程，只记一条告警。
  try {
    log('\n--- 7. 关键词排行 ---');
    const r = await keywords({ date: runDay, summary, scanKeywords: scanAll, log });
    summary.keywords = { total: r.total, file: r.out, top: r.keywords.slice(0, 5).map((k) => `${k.keyword}:${k.df}`) };
  } catch (e) {
    log(`⚠️ 关键词排行跳过：${e.message}`);
    summary.keywords = { skipped: e.message };
  }

  summary.finishedAt = new Date().toISOString();
  const out = writeJSONAtomic(path.join(DATA.logs, `daily-summary-${Date.now()}.json`), summary);
  log(`\n########## 汇总已写入 ${out} ##########`);
  return summary;
}

export const help = 'daily [--platform liepin,boss] [--keywords "..."] [--skip-chat] [--skip-login]';