/**
 * 会话：把「平台 + 标签页 + 可见性/视口」打包，命令层只管业务流程。
 */
import { attach, enableVisibility, openTab, sleep } from './cdp.mjs';
import { getPlatform } from '../platforms/index.mjs';

/**
 * @param {string} platformId
 * @param {object} o
 * @param {string} [o.tabId]    已有标签页 ID（推荐显式传入，避免并行时点错标签）
 * @param {string} [o.newTabUrl] 若无 tabId，则用该 URL 新开标签页
 */
export async function session(platformId, { tabId, newTabUrl } = {}) {
  const platform = getPlatform(platformId);
  let id = tabId;
  if (!id && newTabUrl) {
    const t = await openTab(newTabUrl);
    await sleep(2500);
    id = t.id;
  }
  const { cdp, target } = await attach(id);
  await enableVisibility(cdp, platform.VIEWPORT || 'normal');
  return { cdp, target, platform, tabId: target.id };
}