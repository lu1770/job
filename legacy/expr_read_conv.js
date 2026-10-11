(() => {
  const conv = document.querySelector('.chat-conversation');
  const title = conv ? conv.innerText.replace(/\s+\n/g,'\n').trim() : 'NO_CONV';
  const msgs = [...document.querySelectorAll('li.message-item')].map(li => ({
    me: li.classList.contains('item-myself'),
    time: (li.querySelector('.item-time')?.innerText || '').trim(),
    status: (li.querySelector('.message-status')?.innerText || '').trim(),
    text: (li.querySelector('.message-content')?.innerText || li.innerText || '').trim()
  }));
  // 弹窗检测
  const dialogs = [...document.querySelectorAll('.item-dialog')].map(d => {
    const r = d.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.trim().slice(0,120) };
  }).filter(d => d.w > 10);
  const input = document.querySelector('#chat-input');
  return JSON.stringify({
    convTitle: title.slice(0, 400),
    msgCount: msgs.length,
    msgs: msgs.slice(-14),
    dialogs,
    inputText: input ? input.innerText.trim() : 'NO_INPUT'
  }, null, 1);
})()