// 把 Chrome 窗口恢复正常（解除最小化/隐藏），否则 CDP 点击与懒加载都会失效
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => { ws.onopen = r; });

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = targets.filter((t) => t.type === 'page');
for (const p of pages) {
  try {
    const { windowId } = await send('Browser.getWindowForTarget', { targetId: p.id });
    await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    console.log('restored window', windowId, 'for', p.url.slice(0, 60));
  } catch (e) { console.log('ERR', p.id, e.message); }
}
try { ws.close(); } catch {}
