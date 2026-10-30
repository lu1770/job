/**
 * 命令：login —— 环境与登录态核验（只读，不做任何点击）
 *
 * 检测到某平台未登录时，会自动**新开一个标签卡**并打开该平台的登录入口页
 * （扫码 / 微信登录），交给用户人工完成登录，不做任何自动点击。
 *
 * 用法：node src/cli.mjs login [--platform boss] [--platform liepin]
 */
import { listPages, openTab, PORT } from '../core/cdp.mjs';
import { session } from '../core/session.mjs';
import { getPlatform, PRIORITY } from '../platforms/index.mjs';
import { ensureDirs } from '../core/io.mjs';
import { homeUrlFor } from '../core/city.mjs';

export async function login(opts = {}) {
  const { log = console.log } = opts;
  ensureDirs();

  let pages = [];
  try { pages = await listPages(); } catch {
    log(`❌ CDP (127.0.0.1:${PORT}) 不可达 —— 请先启动带 --remote-debugging-port 的 Chrome`);
    log('   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-cdp" --profile-directory="Profile 1" --disable-blink-features=AutomationControlled');
    return { cdp: false, platforms: {} };
  }
  log(`✅ CDP 可达（端口 ${PORT}），页面标签 ${pages.length} 个`);

  const ids = opts.platform ? [].concat(opts.platform) : PRIORITY;
  const out = {};
  for (const pid of ids) {
    const p = getPlatform(pid);
    try {
      const { cdp, target } = await session(pid, { tabId: opts.tabId, newTabUrl: opts.tabId ? undefined : homeUrlFor(pid, opts.city) });
      await new Promise((r) => setTimeout(r, 3000));
      const probe = p.loginProbe ? await p.loginProbe(cdp) : {};
      cdp.close();
      const ok = probe && (probe.ok ?? (!!probe.name && !probe.loginWall));
      out[pid] = { ok, ...probe };
      log(`${ok ? '✅' : '❌'} ${p.label.padEnd(12)} ${ok ? `已登录${probe.name ? `（${probe.name}）` : ''}` : '未登录 / 被重定向'} ${probe.cards != null ? `| 卡片 ${probe.cards}` : ''}${probe.risk ? ' | ⚠️风控' : ''}${probe.unread ? ` | 未读徽标 ${probe.unread.length}` : ''}`);
      if (!ok) await openLoginTab(p, out[pid], log);
    } catch (e) {
      out[pid] = { ok: false, err: e.message };
      log(`❌ ${p.label} 探测失败：${e.message}`);
    }
  }
  return { cdp: true, pages: pages.length, platforms: out };
}

/** 未登录时新开标签卡打开登录入口页（扫码 / 微信登录），仅打开不做点击。 */
async function openLoginTab(platform, rec, log) {
  if (!platform.loginUrl) return;
  try {
    const t = await openTab(platform.loginUrl);
    rec.loginUrl = platform.loginUrl;
    rec.loginTabId = t && t.id;
    log(`   ↳ 已新开标签卡，请在浏览器中扫码 / 微信登录：${platform.loginUrl}`);
  } catch (e) {
    log(`   ↳ ⚠️ 打开登录页失败：${e.message}`);
  }
}

export const help = 'login [--platform <id>] [--tab <id>]';