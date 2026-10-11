#!/usr/bin/env node
// Minimal native CDP driver for a Chrome instance started with --remote-debugging-port=9222
// Usage: node cdp.mjs <command> [args...]
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9222;
const STATE = path.resolve('.cdp-state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await r.json();
}

function pickTarget(targets) {
  let savedId = null;
  try { savedId = JSON.parse(fs.readFileSync(STATE, 'utf8')).id; } catch {}
  const pages = targets.filter((t) => t.type === 'page');
  if (savedId) {
    const hit = pages.find((p) => p.id === savedId);
    if (hit) return hit;
  }
  const real = pages.find((p) => !p.url.startsWith('chrome://') && !p.url.startsWith('devtools://'));
  const t = real || pages[0];
  if (t) fs.writeFileSync(STATE, JSON.stringify({ id: t.id, url: t.url }));
  return t;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        }
      } else {
        (this.handlers.get(m.method) || []).forEach((h) => h(m.params));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, h) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(h);
  }
  waitEvent(method, timeout = 20000) {
    return new Promise((resolve) => {
      let done = false;
      const h = (p) => { if (!done) { done = true; resolve(p); } };
      this.on(method, h);
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeout);
    });
  }
}

async function connect() {
  const targets = await listTargets();
  const t = pickTarget(targets);
  if (!t) throw new Error('no page target found');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
  const cdp = new CDP(ws);
  // NOTE: intentionally NOT calling Runtime.enable / Page.enable / DOM.enable.
  // Runtime.enable is a well-known CDP fingerprint that anti-bot scripts detect.
  return { cdp, target: t };
}

function keyInfo(ch) {
  const up = ch.toUpperCase();
  if (/[a-zA-Z]/.test(ch)) return { code: 'Key' + up, key: ch, windowsVirtualKeyCode: up.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0) };
  if (/[0-9]/.test(ch)) return { code: 'Digit' + ch, key: ch, windowsVirtualKeyCode: ch.charCodeAt(0), nativeVirtualKeyCode: ch.charCodeAt(0) };
  if (ch === ' ') return { code: 'Space', key: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
  return { code: '', key: ch, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 };
}

const NAMED_KEYS = {
  Enter: { code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { code: 'Backspace', key: 'Backspace', windowsVirtualKeyCode: 8 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 },
};

async function typeHuman(cdp, text, delayMin = 40, delayMax = 130) {
  for (const ch of text) {
    const info = keyInfo(ch);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...info, text: ch, unmodifiedText: ch });
    await sleep(delayMin + Math.random() * (delayMax - delayMin));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info });
    await sleep(15 + Math.random() * 45);
  }
}

async function moveMouse(cdp, x, y, steps = 8) {
  const sx = Math.max(0, x - (30 + Math.random() * 120));
  const sy = Math.max(0, y - (20 + Math.random() * 90));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(sx + (x - sx) * t + (Math.random() - 0.5) * 3);
    const py = Math.round(sy + (y - sy) * t + (Math.random() - 0.5) * 3);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
    await sleep(12 + Math.random() * 25);
  }
}

async function clickAt(cdp, x, y) {
  await moveMouse(cdp, x, y);
  await sleep(60 + Math.random() * 80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40 + Math.random() * 60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function evalJs(cdp, expression, byValue = true) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result ? r.result.value : null;
}

const RECT_FN = `(sel)=>{const el=document.querySelector(sel);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2,tag:el.tagName,text:(el.innerText||el.value||'').slice(0,80)};}`;

const DOM_DUMP = `(()=>{const out=[];document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=link]').forEach(el=>{const r=el.getBoundingClientRect();if(r.width<3||r.height<3)return;const st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden'||st.opacity==='0')return;if(r.y<0||r.y>4000)return;out.push({tag:el.tagName.toLowerCase(),type:el.type||'',text:(el.innerText||el.value||el.placeholder||el.getAttribute('aria-label')||'').trim().slice(0,70),href:(el.href||'').slice(0,140),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});});return out.slice(0,250);})()`;

async function navAndWait(cdp, url) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const st = await evalJs(cdp, 'document.readyState');
      if (st === 'complete') break;
    } catch {}
  }
  await sleep(800 + Math.random() * 700);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) { console.log('usage: node cdp.mjs <cmd> [args]'); process.exit(1); }
  if (cmd === 'list') {
    const t = await listTargets();
    t.filter((x) => x.type === 'page').forEach((p) => console.log(`${p.id}  ${p.url}`));
    return;
  }
  const { cdp, target } = await connect();
  try {
    switch (cmd) {
      case 'target': console.log(target.id, target.url); break;
      case 'url': console.log(await evalJs(cdp, 'location.href')); break;
      case 'title': console.log(await evalJs(cdp, 'document.title')); break;
      case 'nav': await navAndWait(cdp, args[0]); console.log('navigated ->', await evalJs(cdp, 'location.href')); break;
      case 'wait': await sleep(Number(args[0] || 1000)); console.log('waited'); break;
      case 'eval': console.log(JSON.stringify(await evalJs(cdp, args.join(' ')))); break;
      case 'text': console.log(await evalJs(cdp, "document.body.innerText.slice(0,6000)")); break;
      case 'dom': console.log(JSON.stringify(await evalJs(cdp, DOM_DUMP), null, 1)); break;
      case 'rect': console.log(JSON.stringify(await evalJs(cdp, `(${RECT_FN})(${JSON.stringify(args[0])})`))); break;
      case 'type': {
        const sel = args[0]; const text = args.slice(1).join(' ');
        const r = await evalJs(cdp, `(${RECT_FN})(${JSON.stringify(sel)})`);
        if (!r) throw new Error('selector not found: ' + sel);
        await clickAt(cdp, r.cx, Math.min(r.cy, r.y + r.h / 2));
        await sleep(250);
        await typeHuman(cdp, text);
        console.log('typed into', sel);
        break;
      }
      case 'typecoord': {
        const x = Number(args[0]); const y = Number(args[1]); const text = args.slice(2).join(' ');
        await clickAt(cdp, x, y);
        await sleep(250);
        await typeHuman(cdp, text);
        console.log('typed at', x, y);
        break;
      }
      case 'click': {
        if (/^\d+$/.test(args[0]) && args[1] !== undefined) { await clickAt(cdp, Number(args[0]), Number(args[1])); console.log('clicked', args[0], args[1]); break; }
        const r = await evalJs(cdp, `(${RECT_FN})(${JSON.stringify(args[0])})`);
        if (!r) throw new Error('selector not found: ' + args[0]);
        await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(args[0])}).scrollIntoView({block:'center'})` }).catch(() => {});
        await sleep(200);
        const r2 = await evalJs(cdp, `(${RECT_FN})(${JSON.stringify(args[0])})`);
        await clickAt(cdp, r2.cx, r2.cy);
        console.log('clicked', args[0], JSON.stringify(r2.text));
        break;
      }
      case 'press': {
        const info = NAMED_KEYS[args[0]] || keyInfo(args[0]);
        const text = args[0] === 'Enter' ? '\r' : (info.key.length === 1 ? info.key : '');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...info, text, unmodifiedText: text });
        await sleep(40);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info });
        console.log('pressed', args[0]);
        break;
      }
      case 'shot': {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(args[0] || 'shot.png', Buffer.from(data, 'base64'));
        console.log('screenshot ->', args[0] || 'shot.png');
        break;
      }
      case 'clickfollow': {
        const before = new Set((await listTargets()).filter((t) => t.type === 'page').map((t) => t.id));
        await clickAt(cdp, Number(args[0]), Number(args[1]));
        let found = null;
        for (let i = 0; i < 40; i++) {
          await sleep(250);
          const ts = (await listTargets()).filter((t) => t.type === 'page');
          const nw = ts.find((t) => !before.has(t.id));
          if (nw) { found = nw; break; }
        }
        if (!found) { console.log('no new tab opened'); break; }
        fs.writeFileSync(STATE, JSON.stringify({ id: found.id }));
        console.log('new tab:', found.id);
        console.log('url:', found.url);
        break;
      }
      case 'new': {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(args[0] || 'about:blank')}`, { method: 'PUT' });
        const t = await r.json();
        fs.writeFileSync(STATE, JSON.stringify({ id: t.id, url: t.url }));
        console.log('new tab', t.id);
        break;
      }
      case 'switch': {
        fs.writeFileSync(STATE, JSON.stringify({ id: args[0] }));
        console.log('switched to', args[0]);
        break;
      }
      default: console.log('unknown command: ' + cmd); process.exit(1);
    }
  } finally {
    try { cdp.ws.close(); } catch {}
  }
}

main().catch((e) => { console.error('ERR: ' + e.message); process.exit(1); });
