// Shared native-CDP helpers for the 51job (前程无忧) 批量投递 workflow.
// NOTE: intentionally avoids Runtime.enable/Page.enable/DOM.enable (anti-bot fingerprint).
import fs from 'node:fs';
import path from 'node:path';

export const PORT = 9222;
export const STATE = path.resolve('.cdp-state.json');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await r.json();
}

export function currentId() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).id; } catch { return null; }
}

export function switchTo(id) {
  fs.writeFileSync(STATE, JSON.stringify({ id }));
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
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
}

export async function connect(id) {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page');
  const t = (id && pages.find((p) => p.id === id)) || pages.find((p) => !p.url.startsWith('chrome://')) || pages[0];
  if (!t) throw new Error('no page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  return { cdp: new CDP(ws), target: t };
}

export async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result ? r.result.value : null;
}

export async function navAndWait(cdp, url, extraWait = 1200) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { if ((await evalJs(cdp, 'document.readyState')) === 'complete') break; } catch {}
  }
  await sleep(extraWait);
}

// Parse "1.8-3万·14薪" / "30-60万/年" / "3万" -> {minW, maxW} monthly bounds in 万
export function parseSalary(sal) {
  const r = { minW: 0, maxW: 0 };
  if (!sal) return r;
  const y = sal.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万\s*\/\s*年/);
  if (y) { r.minW = parseFloat(y[1]) / 12; r.maxW = parseFloat(y[2]) / 12; return r; }
  const m = sal.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万/);
  if (m) { r.minW = parseFloat(m[1]); r.maxW = parseFloat(m[2]); return r; }
  const s = sal.match(/^(\d+(?:\.\d+)?)\s*万/);
  if (s) { r.minW = parseFloat(s[1]); r.maxW = parseFloat(s[1]); }
  return r;
}

export function parseMaxWan(sal) {
  return parseSalary(sal).maxW;
}

// Extract job cards from the 51job search result page
export const SCAN_CARDS = `(function(){
  const items=[...document.querySelectorAll('.joblist-item')];
  return items.map((it,i)=>{
    const raw=it.querySelector('[sensorsname]');
    const sd=raw?raw.getAttribute('sensorsdata'):'';
    let jobId='',sal='',city='',title='';
    try{const o=JSON.parse(sd);jobId=o.jobId;sal=o.jobSalary;city=o.jobArea;title=o.jobTitle;}catch(e){}
    const btns=[...it.querySelectorAll('.chat,button,span')].map(b=>(b.innerText||'').trim()).filter(t=>t==='投递'||t==='去聊聊'||t.includes('投递'));
    return {i,jobId,sal,city,title,btns:[...new Set(btns)]};
  });
})()`;
