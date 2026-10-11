// 无状态求值工具：直接连指定标签页，不读写 .cdp-state.json（可与后台批量脚本并行使用）
// 用法: node jeval.mjs <tabId> <exprFile> [navUrl]
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';

const [tabId, exprFile, navUrl] = process.argv.slice(2);
const expr = fs.readFileSync(exprFile, 'utf8');
const { cdp } = await connect(tabId);

if (navUrl) {
  await cdp.send('Page.navigate', { url: navUrl });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try { if ((await evalJs(cdp, 'document.readyState')) === 'complete') break; } catch {}
  }
  await sleep(1500);
}
const r = await evalJs(cdp, expr);
console.log(typeof r === 'string' ? r : JSON.stringify(r));
cdp.ws.close();
