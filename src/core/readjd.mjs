/**
 * JD 读取工厂：四个平台的 readJd 尾部逻辑完全一致
 * （读正文 → techFlags → detectAgeLimit），差异只有标题选择器与正文作用域。
 *
 * @param {object} o
 * @param {string} o.head    页面内表达式：标题元素（如 "document.querySelector('h1')"）
 * @param {string} [o.scope] 页面内表达式：正文作用域元素（智联必须限定右侧详情面板，
 *                           否则推荐位/页脚关键词会全量误命中）；缺省读 document.body
 */
import { evalJson } from './cdp.mjs';
import { techFlags } from './criteria.mjs';
import { detectAgeLimit } from './age.mjs';

export function makeReadJd({ head, scope = null }) {
  return async function readJd(cdp) {
    const d = await evalJson(cdp, `(function(){
      const h=${head};
      ${scope ? `const panel=${scope}; const el=panel||document.body;` : 'const el=document.body;'}
      if(!el) return null;
      const t=(el.innerText||'').replace(/\\n{2,}/g,'\\n');
      return JSON.stringify({ title:h?(h.innerText||'').trim():'', body:t.slice(0,5000)${scope
        ? ', scoped:!!panel, bodyLen:(document.body?document.body.innerText.length:0)'
        : ''} });
    })()`, 20000);
    if (!d) return null;
    const out = { jdTitle: d.title, flags: techFlags(d.body), ageLimit: detectAgeLimit(d.body), body: d.body };
    if (scope) { out.scoped = d.scoped; out.pageLen = d.bodyLen; }
    return out;
  };
}
