/**
 * 页面内 JS 表达式生成器：把「找元素 → 滚到可见 → 返回中心坐标」这类
 * 各平台聊天适配器反复复制的片段收敛成参数化模板。
 *
 * 这里不含任何平台选择器 —— 选择器全部由 platforms/*.mjs 作为参数传入。
 * 生成的表达式在页面里执行，返回 JSON 字符串（evalJson 解析）或 'null'。
 */

/**
 * 在列表项中定位目标项，滚动其最近的可滚动祖先使其可见，返回点击坐标。
 *
 * @param {object} o
 * @param {string} o.items      列表项选择器，如 'li' / '.im-ui-contact-list-item'
 * @param {string} [o.itemHas]  过滤条件：项内须包含该子选择器（如 '.friend-content-warp'）
 * @param {string} [o.clickSel] 真正要点击的子元素选择器；缺省点击项本身
 * @param {string} [o.text]     按 innerText 包含匹配定位（虚拟化列表索引会漂移，优先按文本）
 * @param {number} [o.index]    文本缺省时的序号兜底
 * @param {number} [o.offset]   滚动时上留白 px（避免被吸顶头遮挡）
 * @returns {string} 页面表达式：命中 → JSON {i,x,y,w,txt}；未命中 → 'null'
 */
export function exprFindConv({ items, itemHas, clickSel, text = null, index = -1, offset = 120 }) {
  return `(function(){
    let arr=[...document.querySelectorAll(${JSON.stringify(items)})];
    ${itemHas ? `arr=arr.filter(li=>li.querySelector(${JSON.stringify(itemHas)}));` : ''}
    let el=null;
    ${text != null
      ? `for(const it of arr){ if((it.innerText||'').indexOf(${JSON.stringify(text)})>=0){ el=it; break; } }`
      : `el=arr[${index}];`}
    if(!el) return 'null';
    let p=el.parentElement;
    while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
    if(p&&p!==document.body){ const r=el.getBoundingClientRect(),cr=p.getBoundingClientRect(); p.scrollTop += (r.top-cr.top-${offset}); }
    const w=${clickSel ? `el.querySelector(${JSON.stringify(clickSel)})||el` : 'el'};
    const r=w.getBoundingClientRect();
    return JSON.stringify({i:arr.indexOf(el),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),
                           txt:(el.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,160)});
  })()`;
}

/**
 * 把包含首个匹配元素的最近可滚动容器滚到底（消息区 / 会话列表加载更多）。
 * @returns {string} 页面表达式：'ok' | 'no'
 */
export function exprScrollBottom(firstItemSel) {
  return `(function(){
    const li=document.querySelector(${JSON.stringify(firstItemSel)}); if(!li) return 'no';
    let p=li.parentElement;
    while(p&&p!==document.body){ if(p.scrollHeight>p.clientHeight+5) break; p=p.parentElement; }
    if(p&&p!==document.body){ p.scrollTop=p.scrollHeight; return 'ok'; }
    return 'no';
  })()`;
}
