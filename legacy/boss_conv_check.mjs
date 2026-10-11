// 只读：BOSS 聊天列表核验——给定公司/岗位关键词，判断是否已存在会话（=投递已建立联系）
import fs from 'node:fs';
import { connect, evalJs, sleep } from './jlib.mjs';
import { enableVisibility, VIS_WIDE } from './emu.mjs';

const TAB = process.argv[2];
const KEYS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { cdp } = await connect(TAB);
await enableVisibility(cdp, VIS_WIDE);
const ev = (e, ms = 20000) => Promise.race([evalJs(cdp, e), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

await ev(`location.href='https://www.zhipin.com/web/geek/chat';'ok'`, 12000);
await sleep(7000);
// 滚动列表加载全部
for (let i = 0; i < 8; i++) {
  const n = await ev(`document.querySelectorAll('li .friend-content-warp').length`);
  await ev(`(function(){const li=document.querySelector('li .friend-content-warp');if(!li)return 'no';let p=li.parentElement;while(p&&p!==document.body){if(p.scrollHeight>p.clientHeight+5)break;p=p.parentElement;}if(p&&p!==document.body){p.scrollTop=p.scrollHeight;}return 'ok';})()`);
  await sleep(1200);
  const n2 = await ev(`document.querySelectorAll('li .friend-content-warp').length`);
  if (n2 === n && i > 2) break;
}
const list = JSON.parse((await ev(`(function(){
  return JSON.stringify([...document.querySelectorAll('li')].filter(li=>li.querySelector('.friend-content-warp'))
    .map(li=>({txt:(li.innerText||'').replace(/\\s*\\n\\s*/g,' | ').slice(0,200)})));
})()`)) || '[]');
console.log('会话总数:', list.length);
const out = [];
for (const k of KEYS) {
  const hits = list.filter((c) => c.txt.includes(k));
  out.push({ k, found: hits.length, sample: hits.slice(0, 2).map((h) => h.txt.slice(0, 120)) });
  console.log(`${hits.length ? '✅' : '❌'} ${k} → ${hits.length} 个会话`);
  hits.slice(0, 2).forEach((h) => console.log('     ', h.txt.slice(0, 130)));
}
fs.writeFileSync('boss_conv_check_r4.json', JSON.stringify({ total: list.length, out }, null, 1));
cdp.ws.close();
