/**
 * 命令：daily —— 每日投递全流程编排
 *
 * 顺序：登录核验 → 采集 → JD 核验 → 生成清单 → 投递 → 复核 → 会话巡检
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
import { PRIORITY, parseList } from '../platforms/index.mjs';
import { writeJSONAtomic, DATA } from '../core/io.mjs';
import path from 'node:path';

export async function daily(opts = {}) {
  const { log = console.log, skipChat = false, skipLogin = false } = opts;
  const pids = parseList(opts.platform, PRIORITY.slice(0, 2)); // 默认只跑猎聘 + BOSS
  const summary = { startedAt: new Date().toISOString(), platforms: {} };

  if (!skipLogin) {
    log('\n########## 0. 登录 / 环境核验 ##########');
    const env = await login({ ...opts, platform: pids });
    summary.env = env;
    if (!env.cdp) return summary;
  }

  for (const pid of pids) {
    const P = { platform: pid };
    log(`\n########## ${pid} ##########`);
    try {
      if (!skipLogin && summary.env?.platforms?.[pid]?.ok === false) {
        log(`跳过 ${pid}：未登录`);
        summary.platforms[pid] = { skipped: 'not_logged_in' };
        continue;
      }
      log('\n--- 1. 采集 ---');
      const s = await scan({ ...opts, ...P });
      if (s.stopped && !s.total) { summary.platforms[pid] = { stopped: s.stopped }; continue; }

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
        scan: { file: s.file, total: s.total, hit: s.hit },
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

  summary.finishedAt = new Date().toISOString();
  const out = writeJSONAtomic(path.join(DATA.logs, `daily-summary-${Date.now()}.json`), summary);
  log(`\n########## 汇总已写入 ${out} ##########`);
  return summary;
}

export const help = 'daily [--platform liepin,boss] [--keywords "..."] [--skip-chat] [--skip-login]';