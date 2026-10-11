// 诊断窗口/可见性并可强制激活页面
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.filter((t) => t.type === 'page').find((t) => /zhipin\.com/.test(t.url)) || targets.find((t) => t.type === 'page');
console.log('target:', page.id, page.url.slice(0, 70));

const bw = new WebSocket(ver.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
bw.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const bsend = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); bw.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => { bw.onopen = r; });

try {
  const { windowId, bounds } = await bsend('Browser.getWindowForTarget', { targetId: page.id });
  console.log('windowId', windowId, 'bounds', JSON.stringify(bounds));
  await bsend('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: 0, top: 0, width: 1600, height: 1000 } });
  const after = await bsend('Browser.getWindowBounds', { windowId });
  console.log('after', JSON.stringify(after.bounds));
} catch (e) { console.log('win ERR', e.message); }
try { bw.close(); } catch {}

// 页面级激活
const pw = new WebSocket(page.webSocketDebuggerUrl);
let pid = 0; const ppend = new Map();
pw.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && ppend.has(m.id)) { const p = ppend.get(m.id); ppend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const psend = (method, params = {}) => new Promise((res, rej) => { const i = ++pid; ppend.set(i, { res, rej }); pw.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => { pw.onopen = r; });
try {
  await psend('Page.setWebLifecycleState', { state: 'active' });
  console.log('setWebLifecycleState: ok');
} catch (e) { console.log('lifecycle ERR', e.message); }
await new Promise((r) => setTimeout(r, 800));
const r = await psend('Runtime.evaluate', { expression: `JSON.stringify({hidden:document.hidden,vis:document.visibilityState,iw:innerWidth,ih:innerHeight,focus:document.hasFocus()})`, returnByValue: true });
console.log('page state:', r.result.value);
try { pw.close(); } catch {}
