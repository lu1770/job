/**
 * 会话：把「平台 + 标签页 + 可见性/视口」打包，命令层只管业务流程。
 */
import { attach, enableVisibility, openTab, listPages, sleep } from './cdp.mjs';
import { getPlatform } from '../platforms/index.mjs';

/** 平台自有标签的归属特征（HOST 子串；缺省回退到 homeUrl 的 host） */
function hostOf(p) {
  if (p.HOST) return p.HOST;
  try { return new URL(p.homeUrl).host; } catch { return ''; }
}

/**
 * ⚠️ 未显式传 tabId 时**绝不** attach 到「第一个页面」：
 *    共享浏览器里并发跑两个平台/两个运行时，`attach(undefined)` 会各自抢到同一个标签，
 *    双方互相 `Page.navigate` 覆盖 —— 页面内容串台。
 *    实测：鱼泡采集读到猎聘详情页（`关于猎聘`/`继续沟通` 文案），`SCAN_CARDS` 找不到 `/qiye/`
 *    锚点 → 误报 `no_cards`，实为「采到了别的平台的页面」。
 *    正确做法：按 HOST 认领**本平台自己的**标签；没有则新开一个本平台标签。
 *
 * @param {string} platformId
 * @param {object} o
 * @param {string} [o.tabId]    已有标签页 ID（推荐显式传入，避免并行时点错标签）
 * @param {string} [o.newTabUrl] 无 tabId 且无本平台标签时，用该 URL 新开（缺省 platform.homeUrl）
 */
export async function session(platformId, { tabId, newTabUrl } = {}) {
  const platform = getPlatform(platformId);
  let id = tabId;
  if (!id) {
    const host = hostOf(platform);
    if (host) {
      const own = (await listPages()).find((p) => (p.url || '').includes(host));
      if (own) id = own.id;
    }
    if (!id) {
      const t = await openTab(newTabUrl || platform.homeUrl || 'about:blank');
      await sleep(2500);
      id = t.id;
    }
  }
  const { cdp, target } = await attach(id);
  await enableVisibility(cdp, platform.VIEWPORT || 'normal');
  return { cdp, target, platform, tabId: target.id };
}