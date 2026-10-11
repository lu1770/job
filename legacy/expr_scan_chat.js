(() => {
  const items = [...document.querySelectorAll('li')].filter(li => li.querySelector('.friend-content-warp'));
  const out = items.map((li, i) => {
    const badge = li.querySelector('.notice-badge');
    const badgeTxt = badge ? badge.innerText.trim() : '';
    const last = li.querySelector('.last-msg-text');
    const warp = li.querySelector('.friend-content-warp');
    return {
      i,
      badge: badgeTxt,
      text: (warp ? warp.innerText : li.innerText).replace(/\s+\n/g, '\n').trim(),
      cls: li.className
    };
  });
  const unreadFilter = [...document.querySelectorAll('*')].filter(e => e.children.length===0 && /^未读\(\d+\)$/.test((e.textContent||'').trim())).map(e=>(e.textContent||'').trim());
  return JSON.stringify({
    url: location.href,
    title: document.title,
    count: items.length,
    unreadBadges: out.filter(o=>o.badge).length,
    unreadFilterTexts: [...new Set(unreadFilter)],
    items: out
  }, null, 1);
})()