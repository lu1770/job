/**
 * URL / 岗位 ID 解析工具。
 *
 * 为什么需要它：早期智联适配器用 `/jobdetail\/(\d+)/` 从卡片 href 里抠岗位 ID，
 * 结果长期为 0 —— 因为**智联搜索结果卡片里根本没有职位详情链接**，
 * 唯一的 <a> 是公司页 `companydetail/CZxxxx.htm`。
 * 正则匹配不到不是正则写错，而是「这个平台上根本不存在这种 URL」。
 *
 * 因此这里提供两级能力：
 *   1. absUrl()      —— 把各种形态的 href 规整成绝对 URL（相对、协议相对、缺 scheme）；
 *   2. jobIdFrom()   —— 多模式依次尝试 + 「最后一段有效路径」兜底，取不到就返回 null，
 *                       绝不返回半截字符串糊弄上层。
 *
 * 调用方约定：**取不到 id 就返回 null**，并改用业务指纹（标题+公司/薪资）去重，
 * 或改走「点击卡片 + 详情面板」的非 URL 交互模型（智联即如此）。
 */

/** 把 href 规整为绝对 URL；无法判定基准时返回 null */
export function absUrl(href, base) {
  const s = String(href || '').trim();
  if (!s) return null;
  if (/^(javascript|mailto|tel):/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return 'https:' + s;
  if (!base) return null;
  try { return new URL(s, base).href; } catch { return null; }
}

/** 依次尝试多个正则，返回第一个捕获组 */
export function firstMatch(str, patterns = []) {
  const s = String(str || '');
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** 去掉查询串/锚点后的路径部分 */
function pathOf(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname || '');
  } catch {
    return String(url).split(/[?#]/)[0];
  }
}

const GENERIC_SEGMENT = /^(index|home|search|jobs?|list|detail|position|cc|default)\.?$/i;

/**
 * 从职位 URL 提取岗位 ID。
 * @param {string} url
 * @param {object} o
 * @param {RegExp[]} [o.patterns]  平台专属模式，优先尝试
 * @param {boolean}  [o.fallbackToPath] 取不到时是否退化为「最后一段有效路径」
 * @returns {string|null} 取不到返回 null
 */
export function jobIdFrom(url, { patterns = [], fallbackToPath = true } = {}) {
  const abs = absUrl(url);
  if (!abs) return null;

  const hit = firstMatch(abs, patterns);
  if (hit) return hit;

  if (!fallbackToPath) return null;
  const segs = pathOf(abs).split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i].replace(/\.(html?|shtml|aspx|jsp)$/i, '');
    if (!seg || GENERIC_SEGMENT.test(seg)) continue;
    if (/^[a-z]{2,4}$/i.test(seg)) continue; // 纯字母段（CC/JAVACSD 之类的主机名片段无区分度）
    return seg;
  }
  return null;
}

/** 业务指纹：URL 不可用时的稳定去重键（智联走这条） */
export function fingerprint({ title, company, salary }) {
  return [title, company, salary].map((x) => String(x || '').trim()).filter(Boolean).join('|');
}