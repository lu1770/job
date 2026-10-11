/**
 * 命令：apply —— 统一投递引擎（BOSS / 猎聘 / 51job / 智联 共用）
 *
 * 平台差异全部下沉到 platforms/*.mjs 的 applyOne()；这里只管
 * 节奏控制、逐条落盘、风控熔断、失败重试与汇总。
 *
 * 用法：
 *   node src/cli.mjs apply --platform boss --in data/lists/boss-targets-xxx.json
 *   node src/cli.mjs apply --platform boss --retry-logs data/logs/boss-apply-xxx.json
 */
import { session } from '../core/session.mjs';
import { readJSON, latestDataFile, dataPath, createSink, writeJSONAtomic } from '../core/io.mjs';
import { sleep } from '../core/cdp.mjs';
import { paceOf } from '../platforms/index.mjs';

export async function apply(opts = {}) {
  const { platform: pid, log = console.log } = opts;
  const listFile = opts.in || latestDataFile('lists', `${pid}-targets`);
  let items;
  let mode = 'apply';

  if (opts.retryLogs) {
    // 重投模式：只挑上次未落库的条目
    const prev = readJSON(opts.retryLogs, []) || [];
    const bad = new Set(['unknown', 'quota_blocked', 'js_fail', 'no_btn', 'out_of_viewport', 'slider_blocked', 'risk_blocked', 'error']);
    items = prev.filter((r) => bad.has(r.result));
    mode = 'retry';
    log(`重投模式：上次 ${prev.length} 条，其中 ${items.length} 条未落库`);
  } else {
    if (!listFile) throw new Error(`找不到 ${pid} 的投递清单，请先跑 targets`);
    items = readJSON(listFile, []) || [];
    log(`投递清单：${listFile}（${items.length} 条）`);
  }
  if (!items.length) { log('无待投递条目'); return { count: 0, log: null }; }

  const { cdp, platform } = await session(pid, { tabId: opts.tabId });
  const file = opts.out || dataPath('logs', `${pid}-${mode}`);
  const sink = createSink(file);
  const pace = paceOf(platform);

  let ok = 0, already = 0, fail = 0, unknown = 0;
  let stopped = null;
  let quota = null;

  log(`\n=== ${platform.label} 投递（${mode}）${items.length} 条｜节奏 ${pace.min / 1000}-${pace.max / 1000}s ===`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rec = { ...item };
    const tag = `[${i + 1}/${items.length}] ${(item.title || '').slice(0, 26)} ${item.sal || ''}`;
    try {
      const r = await platform.applyOne(cdp, item);
      Object.assign(rec, r);
      if (r.result === 'ok') ok++;
      else if (r.result === 'already') already++;
      else if (r.result === 'unknown') unknown++;
      else fail++;

      // 熔断：额度触顶 / 风控 / 滑块 → 立即停止，不空转
      if (r.result === 'quota_blocked' || r.result === 'risk_blocked' || r.result === 'slider_blocked') {
        quota = r.quota || r.guard || null;
        stopped = r.result;
        log(`${tag} -> ⛔ ${r.result}${quota ? ' ' + JSON.stringify(quota) : ''} —— 停止本平台`);
        sink.push(rec);
        break;
      }
      const mark = { ok: '✅', already: '⏭', unknown: '⚠️' }[r.result] || '❌';
      log(`${tag} -> ${mark} ${r.result}`);
    } catch (e) {
      rec.result = 'error';
      rec.err = e.message;
      fail++;
      log(`${tag} -> ❌ ${e.message}`);
    }
    sink.push(rec);
    if (i < items.length - 1) await sleep(pace.min + Math.random() * (pace.max - pace.min));
  }

  sink.flush();
  cdp.close();
  log(`\n===== ${platform.label} 投递完成：成功 ${ok} / 已沟通 ${already} / 未知 ${unknown} / 失败 ${fail} =====`);
  if (stopped) log(`⚠️ 提前停止：${stopped} ${quota ? JSON.stringify(quota) : ''}`);
  return { count: sink.rows.length, ok, already, unknown, fail, log: file, stopped, quota, rows: sink.rows };
}

/**
 * 命令：verify —— 逐条复盘核对
 * 策略：重跑投递引擎（已沟通会自动跳过），未落库的会自动补投。
 */
export async function verify(opts = {}) {
  const { platform: pid, log = console.log } = opts;
  const listFile = opts.in || latestDataFile('lists', `${pid}-targets`);
  if (!listFile) throw new Error(`找不到 ${pid} 的投递清单`);
  const items = readJSON(listFile, []) || [];

  // 只读巡检（probe）模式：不点击，仅读按钮状态
  if (opts.probe) return probeAll(pid, items, opts);

  log(`复核 ${items.length} 条（重跑投递引擎，已沟通自动跳过，未落库自动补投）`);
  const r = await apply({ ...opts, in: listFile, out: dataPath('logs', `${pid}-verify`) });
  return r;
}

export async function probeAll(pid, items, opts = {}) {
  const { log = console.log } = opts;
  const { cdp, platform } = await session(pid, { tabId: opts.tabId });
  const file = opts.out || dataPath('logs', `${pid}-probe`);
  const sink = createSink(file);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const r = platform.probeItem ? await platform.probeItem(cdp, it) : { title: it.title, btn: 'n/a' };
      sink.push({ ...it, ...r });
      log(`[${i + 1}/${items.length}] ${(it.title || '').slice(0, 26)} | ${(it.company || '').slice(0, 16)} | ${r.btn}`);
    } catch (e) {
      sink.push({ ...it, err: e.message });
      log(`[${i + 1}] ❌ ${e.message}`);
    }
    await sleep(2500);
  }
  sink.flush();
  cdp.close();
  log(`巡检完成 ${sink.rows.length} 条 -> ${file}`);
  return { rows: sink.rows, file };
}

export const help = 'apply --platform <id> [--in list.json | --retry-logs logs.json] [--tab <id>]';
export const verifyHelp = 'verify --platform <id> [--in list.json] [--probe]';
export { writeJSONAtomic };