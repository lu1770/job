// 把 CDP 浏览器窗口恢复为正常（取消最小化）并聚焦指定标签页
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws err')); });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => t.type === 'page');
const target = pages.find((p) => /51job/.test(p.url)) || pages[0];
const { windowId } = await send('Browser.getWindowForTarget', { targetId: target.id });
await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
const b = await send('Browser.getWindowBounds', { windowId });
console.log('windowId', windowId, '->', JSON.stringify(b.bounds));
console.log('focused tab:', target.url.slice(0, 80));
ws.close();
