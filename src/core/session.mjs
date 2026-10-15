/**
 * 会话：把「平台 + 标签页 + 可见性/视口」打包，命令层只管业务流程。
 */
import { attach, enableVisibility, openTab, sleep } from './cdp.mjs';
import { getPlatform } from '../platforms/index.mjs';

/**
 * ⚠️ 未显式传 tabId 时**一律新开标签**，绝不复用/抢占既有页面：
 *    共享浏览器里 attach(undefined)（选「第一个页面」）或按 HOST 复用旧标签，
 *    都会被并发运行的其他进程/平台抢占 —— 双方互相 Page.navigate 覆盖，内容串台。
 *    实测：鱼泡采集读到猎聘详情页（`关于猎聘`/`继续沟通` 文案），SCAN_CARDS 找不到
 *    `/qiye/` 锚点 → 误报 no_cards，实为「采到了别的平台的页面」。
 *    daily 会为每个平台开一张专用标签，并把 tabId 贯穿采集→核验→投递→复核→巡检。
 *
 * @param {string} platformId
 * @param {object} o
 * @param {string} [o.tabId]    已有标签页 ID（daily 专用标签 / 用户 --tab 显式指定）
 * @param {string} [o.newTabUrl] 无 tabId 时新标签的起始 URL（缺省 platform.homeUrl）
 */
export async function session(platformId, { tabId, newTabUrl } = {}) {
  const platform = getPlatform(platformId);
  let id = tabId;
  if (!id) {
    const t = await openTab(newTabUrl || platform.homeUrl || 'about:blank');
    await sleep(2500);
    id = t.id;
  }
  const { cdp, target } = await attach(id);
  await enableVisibility(cdp, platform.VIEWPORT || 'normal');
  return { cdp, target, platform, tabId: target.id };
}
