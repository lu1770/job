// 尝试用 Emulation 让页面"看似聚焦可见"，然后测试 BOSS 会话切换
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.filter((t) => t.type === 'page').find((t) => t.id === process.argv[2]) || targets.find((t) => t.type === 'page');
const pw = new WebSocket(page.webSocketDebuggerUrl);
let pid = 0; const ppend = new Map();
pw.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && ppend.has(m.id)) { const p = ppend.get(m.id); ppend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
const psend = (method, params = {}) => new Promise((res, rej) => { const i = ++pid; ppend.set(i, { res, rej }); pw.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => { pw.onopen = r; });

for (const [m, p] of [
  ['Emulation.setFocusEmulationEnabled', { enabled: true }],
  ['Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1400, screenHeight: 900 }],
]) {
  try { await psend(m, p); console.log('ok', m); } catch (e) { console.log('ERR', m, e.message); }
}
await new Promise((r) => setTimeout(r, 1000));
const r = await psend('Runtime.evaluate', { expression: `JSON.stringify({hidden:document.hidden,vis:document.visibilityState,iw:innerWidth,ih:innerHeight,focus:document.hasFocus(),n:document.querySelectorAll('.friend-content-warp').length})`, returnByValue: true });
console.log('state:', r.result.value);
try { pw.close(); } catch {}
