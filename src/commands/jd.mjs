/**
 * 命令：jd —— 逐岗实读 JD 正文，判定技术栈 + 年龄限制（落 data/work/）
 *
 * 这是最贵的一步（每岗一次详情页访问）。猎聘约 120 次会触发风控，
 * 因此先做「薪资/城市/粗筛/去重」四重前置过滤，再进详情页。
 *
 * 用法：node src/cli.mjs jd --platform boss --in data/raw/boss-scan-xxx.json
 */
import { session } from '../core/session.mjs';
import { dataPath, readJSON, latestDataFile, createSink } from '../core/io.mjs';
import { sleep, navigate } from '../core/cdp.mjs';
import { capK } from '../core/salary.mjs';
import { blockedCompany, coarseScreen, requireScreen, cityOk, criteria } from '../core/criteria.mjs';
import { loadHistory, historyIndex, isSeen } from '../core/dedupe.mjs';
import { dedupeProfile } from '../platforms/index.mjs';

export async function jd(opts = {}) {
  const { platform: pid, capKMin = criteria().capKMin, dedupe = true, limit = 0, log = console.log } = opts;
  const { cdp, platform } = await session(pid, { tabId: opts.tabId });

  const inFile = opts.in || latestDataFile('raw', `${pid}-scan`);
  if (!inFile) throw new Error(`找不到 ${pid} 的采集结果，请先跑 scan`);
  const base = readJSON(inFile, []) || [];
  log(`读入采集：${inFile}（${base.length} 岗）`);

  // ---- 前置过滤（不进详情页）
  const hist = historyIndex(loadHistory(pid));
  // 去重口径统一来自平台注册表（BOSS/鱼泡按标题+公司，猎聘/51job按标题+薪资，智联按卡KEY）
  const dedupeInfo = dedupeProfile(pid);
  const dropped = [];
  let cand = [];
  for (const j of base) {
    const title = j.title || j.name || '';
    if (capK(j.sal || j.salary) < capKMin) { dropped.push({ ...j, why: `薪资上限<${capKMin}K` }); continue; }
    if (!cityOk(j)) { dropped.push({ ...j, why: '非苏州' }); continue; }
    const blk = blockedCompany(j.company || j.txt || '');
    if (blk) { dropped.push({ ...j, why: `屏蔽:${blk}` }); continue; }
    const coarse = coarseScreen(title);
    if (!coarse.ok) { dropped.push({ ...j, why: coarse.why }); continue; }
    if (!requireScreen(title)) { dropped.push({ ...j, why: '非开发主线' }); continue; }
    if (dedupe && isSeen(hist, j, dedupeInfo.keyOf, dedupeInfo.idRe)) { dropped.push({ ...j, why: '历史已处理（已投递/已核验）' }); continue; }
    cand.push(j);
  }
  if (limit) cand = cand.slice(0, limit);
  log(`粗筛通过 ${cand.length}（剔除 ${dropped.length}）｜待核验 ${cand.length}`);

  // ---- 逐岗核验
  const file = opts.out || dataPath('work', `${pid}-jd`);
  const sink = createSink(file);
  let stopped = null;
  let i = 0;
  for (const j of cand) {
    i++;
    const rec = { ...j };
    let navUrl = null;
    // JD 全文落盘（readJd 返回 withFlags 结构，含 flags/ageLimit/body）
    const put = (d) => {
      rec.jdTitle = d.jdTitle;
      rec.flags = d.flags;
      rec.ageLimit = d.ageLimit || null;
      rec.jd = d.body || '';
      rec.excerpt = (d.body || '').replace(/\s+/g, ' ').slice(0, 220);
    };
    try {
      // 无 URL 平台（如智联）由适配器自己「点卡片开面板」；其余走详情页导航
      if (typeof platform.openJob === 'function') {
        const opened = await platform.openJob(cdp, j);
        if (opened && opened.ok === false) rec.err = opened.why || 'open_failed';
        else if (opened && j.title && opened.panelTitle && opened.panelTitle !== j.title) {
          rec.err = `panel_mismatch:${opened.panelTitle}`;
        }
      } else {
        navUrl = platform.resolveUrl ? platform.resolveUrl(j) : (j.url || j.href);
        if (!navUrl) rec.err = 'no_url';
        else await navigate(cdp, navUrl, { settle: 900 });
      }
      const d = rec.err ? null : await platform.readJd(cdp);
      if (d) put(d); else if (!rec.err) rec.err = 'read_failed';
      let g = platform.guard ? await platform.guard(cdp) : null;
      // 平台滑块自愈（如 job51）：等 sliderWaitMs 后刷新重读本岗，而不是停整批
      if (g && g.slider && platform.sliderWaitMs && navUrl) {
        log(`[${i}/${cand.length}] ${(j.title || '').slice(0, 28)} -> ⏳ 滑块，等 ${platform.sliderWaitMs / 60000} 分钟后刷新重试`);
        await sleep(platform.sliderWaitMs);
        await navigate(cdp, navUrl, { settle: 1600 });
        const d2 = await platform.readJd(cdp);
        if (d2 && d2.jdTitle) { put(d2); rec.err = null; }
        g = await platform.guard(cdp);
      }
      if (g && (g.slider || g.risk || g.loginWall)) {
        rec.stopped = g;
        sink.push(rec);
        stopped = g;
        log(`!! 命中风控/登录墙，停止：${JSON.stringify(g)}`);
        break;
      }
      const flags = rec.flags ? Object.entries(rec.flags).filter(([, v]) => v).map(([k]) => k).join(',') : '-';
      log(`[${i}/${cand.length}] ${(j.title || '').slice(0, 28)} ${j.sal || ''} | ${flags}${rec.ageLimit ? ' ⛔年龄:' + rec.ageLimit.hit : ''}`);
    } catch (e) {
      rec.err = e.message;
      log(`[${i}/${cand.length}] ${(j.title || '').slice(0, 28)} -> ❌ ${e.message}`);
    }
    sink.push(rec);
    await sleep(3500 + Math.random() * 2500);
  }
  sink.flush();
  cdp.close();
  log(`\n核验完成：${sink.rows.length} 条 -> ${file}${stopped ? '（未跑完）' : ''}`);
  return { file, count: sink.rows.length, stopped, dropped };
}

export const help = 'jd --platform <id> [--in <scan.json>] [--cap 25] [--no-dedupe] [--limit N] [--tab <id>]';