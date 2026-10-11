// Usage: node refresh_scan.mjs <fullTabId>
import { connect, evalJs, sleep } from './jlib.mjs';

const tabId = process.argv[2];
const { cdp } = await connect(tabId);
await evalJs(cdp, 'location.reload(); 1');
await sleep(6000);
const scan = await evalJs(cdp, `(() => {
  const items = [...document.querySelectorAll('li')].filter(li => li.querySelector('.friend-content-warp'));
  const out = items.map((li,i) => {
    const badge = li.querySelector('.notice-badge');
    return { i, badge: badge ? (badge.textContent||'').trim() : '',
      text: (li.querySelector('.friend-content-warp')||li).innerText.replace(/\\s+\\n/g,'\\n').trim() };
  });
  return JSON.stringify({ url: location.href, count: items.length,
    unread: out.filter(o=>o.badge).length, items: out }, null, 1);
})()`);
console.log(scan);
process.exit(0);