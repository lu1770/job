// 打开新标签页 / 列出标签页
import { sleep } from './jlib.mjs';
const PORT = 9222;
const cmd = process.argv[2] || 'list';
const url = process.argv[3];

if (cmd === 'open') {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const t = await r.json();
  await sleep(2500);
  console.log(JSON.stringify({ id: t.id, url: t.url }, null, 0));
} else {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const d = await r.json();
  for (const p of d) if (p.type === 'page') console.log(p.id, '|', (p.url || '').slice(0, 110));
}
