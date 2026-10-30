/**
 * CDP 底座：连接、JS 求值、导航、真人化鼠标/键盘、页面可见性模拟。
 *
 * 反爬铁律：绝不调用 Runtime.enable / Page.enable / DOM.enable（平台检测到会秒关标签页）。
 */
import { WebSocketImpl } from './ws.mjs';

// Node 22 自带 WebSocket；Node 18/20 没有，回退到自带实现（否则 login/daily 直接报 WebSocket is not defined）
const WebSocketCtor = globalThis.WebSocket || WebSocketImpl;

export const PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://127.0.0.1:${PORT}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (a, b) => a + Math.random() * (b - a);

export function withTimeout(promise, ms = 15000, label = 'op') {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

// ---------------------------------------------------------------- CDP 连接

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else {
        (this.handlers.get(m.method) || []).forEach((h) => h(m.params));
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  waitEvent(method, timeout = 20000) {
    return new Promise((resolve) => {
      let done = false;
      const h = (p) => { if (!done) { done = true; resolve(p); } };
      this.on(method, h);
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeout);
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

export async function listTargets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

export async function listPages() {
  return (await listTargets()).filter((t) => t.type === 'page');
}

/**
 * 绑定标签页。
 * @param {string} [tabId] 完整标签页 ID —— 并行场景必须显式传入，否则 fallback 到第一个页面
 */
export async function attach(tabId) {
  const pages = await listPages();
  const t = (tabId && pages.find((p) => p.id === tabId)) || pages.find((p) => !p.url.startsWith('chrome://')) || pages[0];
  if (!t) throw new Error('no page target（CDP 是否已启动？）');
  const ws = new WebSocketCtor(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  return { cdp: new CDP(ws), target: t };
}

export async function openTab(url = 'about:blank') {
  const r = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return r.json();
}

// ---------------------------------------------------------------- JS / 导航

export async function evalJs(cdp, expression, timeout = 15000) {
  const r = await withTimeout(
    cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }),
    timeout,
    String(expression).slice(0, 48),
  );
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result ? r.result.value : null;
}

/** 在页面里求值并返回 JSON（页面表达式自行 JSON.stringify） */
export async function evalJson(cdp, expression, timeout = 15000) {
  const raw = await evalJs(cdp, expression, timeout);
  if (raw == null || raw === '') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function navigate(cdp, url, { settle = 1200, timeout = 40000 } = {}) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { if ((await evalJs(cdp, 'document.readyState', 8000)) === 'complete') break; } catch { /* 渲染中 */ }
  }
  await sleep(settle);
}

// ---------------------------------------------------------------- 真人化输入

export async function moveMouse(cdp, x, y, steps = 6) {
  const sx = Math.max(0, x - rand(30, 120));
  const sy = Math.max(0, y - rand(20, 90));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(sx + (x - sx) * t + rand(-2, 2)),
      y: Math.round(sy + (y - sy) * t + rand(-2, 2)),
    });
    await sleep(rand(10, 26));
  }
}

/** 真实鼠标点击。BOSS/猎聘/智联的详情页按钮会静默忽略它，投递请走 JS click。 */
export async function clickAt(cdp, x, y) {
  await moveMouse(cdp, x, y);
  await sleep(rand(60, 130));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(rand(40, 90));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const NAMED_KEYS = {
  Enter: { code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9, text: '' },
  Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27, text: '' },
  Backspace: { code: 'Backspace', key: 'Backspace', windowsVirtualKeyCode: 8, text: '' },
};

function keyInfo(ch) {
  if (NAMED_KEYS[ch]) return NAMED_KEYS[ch];
  const up = ch.toUpperCase();
  if (/[a-zA-Z]/.test(ch)) return { code: 'Key' + up, key: ch, windowsVirtualKeyCode: up.charCodeAt(0), text: ch };
  if (/[0-9]/.test(ch)) return { code: 'Digit' + ch, key: ch, windowsVirtualKeyCode: ch.charCodeAt(0), text: ch };
  if (ch === ' ') return { code: 'Space', key: ' ', windowsVirtualKeyCode: 32, text: ' ' };
  return { code: '', key: ch, windowsVirtualKeyCode: 0, text: ch };
}

export async function typeHuman(cdp, text, { min = 40, max = 130 } = {}) {
  for (const ch of text) {
    const info = keyInfo(ch);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...info, unmodifiedText: info.text });
    await sleep(rand(min, max));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info });
    await sleep(rand(15, 45));
  }
}

export async function pressKey(cdp, key) {
  const info = keyInfo(key);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...info, unmodifiedText: info.text });
  await sleep(40);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info });
}

// ---------------------------------------------------------------- 可见性 / 视口

/**
 * 视口预设。注意本机 OS 缩放 150%，实际 CSS 视口 = 设定值 ÷ 1.5。
 * 页面布局宽 ~1200 时必须用 wide，否则按钮落在视口外导致真实点击静默失效。
 */
export const VIEWPORTS = {
  normal: { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false },
  wide: { width: 2400, height: 1500, deviceScaleFactor: 1, mobile: false },
};

/**
 * 窗口最小化时 document.hidden=true，所有真实鼠标点击会静默失效（JS click 不受影响）。
 * 必须开启焦点模拟 + 视口覆盖才能恢复。
 */
export async function enableVisibility(cdp, preset = 'normal') {
  const v = typeof preset === 'string' ? VIEWPORTS[preset] : preset;
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  if (v) await cdp.send('Emulation.setDeviceMetricsOverride', { ...v, screenWidth: v.width, screenHeight: v.height }).catch(() => {});
  await sleep(300);
}

/** 取元素中心坐标（用于真实点击） */
export async function rectOf(cdp, selector) {
  return evalJson(cdp, `(function(){
    const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return null;
    const r=el.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:Math.round(r.width), h:Math.round(r.height),
            text:(el.innerText||'').trim().slice(0,60)};
  })()`);
}