/**
 * 命令：chat —— 统一沟通处理：读会话 + 发消息
 *
 * 读：node src/cli.mjs chat read --platform boss --unread-only
 * 发：node src/cli.mjs chat send --platform boss --file replies.json
 *      replies.json = [{ "key":"段向阳", "verify":"科瑞恩", "text":"..." }]
 *
 * 铁律（来自用户口径）：
 *  - 只回实质提问；客套与婉拒一律不回；
 *  - 遇到授权卡（简历/联系方式/微信交换）先索要 JD，绝不代点；
 *  - 发送前必须校验「会话确已打开」（比对 verify 串），防发错人。
 */
import { session } from '../core/session.mjs';
import { readJSON, latestDataFile, writeJSONAtomic, dataPath } from '../core/io.mjs';
import { sleep } from '../core/cdp.mjs';

export async function chatRead(opts = {}) {
  const { platform: pid, log = console.log, unreadOnly = false, max = 30 } = opts;
  const { cdp, platform } = await session(pid, { tabId: opts.tabId });
  if (platform.chatSupported === false) {
    log(`${platform.label}：PC 端无消息中心，跳过（${(platform.notes || []).join('；')}）`);
    cdp.close();
    return { skipped: true };
  }

  // 猎聘需要用职位页把 IM 抽屉拉起来
  let seed = [];
  if (typeof platform.listConversations === 'function' && platform.id === 'liepin') {
    seed = readJSON(opts.seed || latestDataFile('lists', 'liepin-targets'), []) || [];
    if (!seed.length) log('⚠️ 未提供种子职位页，猎聘抽屉可能拉不起来');
  }

  const opened = await platform.listConversations(cdp, seed);
  const list = Array.isArray(opened) ? opened : opened.list || [];
  if (opened && opened.opened === false) { log('未能打开消息中心'); cdp.close(); return { opened: false }; }

  const targets = (unreadOnly ? list.filter((c) => c.badge) : list).slice(0, max);
  log(`会话总数 ${list.length}｜本次读取 ${targets.length}`);

  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const got = await platform.readConversation(cdp, t);
    // 平台字段名归一化：BOSS 用 me/text，猎聘用 mine/txt
    const msgs = ((got && got.msgs) || []).map((m) => ({
      mine: !!(m.mine ?? m.me),
      isTime: !!m.isTime,
      txt: String(m.txt ?? m.text ?? ''),
    }));
    const real = msgs.filter((m) => !m.isTime && m.txt);
    const last = real[real.length - 1];
    const rec = {
      ...t,
      head: (got && got.head) || '',
      dialogs: (got && got.dialogs) || [],
      lastFromMe: last ? !!last.mine : null,
      lastText: last ? last.txt : '',
      msgs: real.slice(-8),
    };
    rows.push(rec);
    log(`[${i + 1}/${targets.length}] ${(t.txt || t.name || '').slice(0, 30)} | 末条: ${last ? (last.mine ? '我' : '对方') + ': ' + last.txt.replace(/\n/g, ' ').slice(0, 50) : '无'}`);
    writeJSONAtomic(opts.out || dataPath('work', `${pid}-chat`), rows);
    await sleep(800);
  }
  cdp.close();
  const needReply = rows.filter((r) => r.lastFromMe === false);
  log(`\n末条为对方（可能需回复）：${needReply.length} 条 —— 请人工/规则判定后再发`);
  return { rows, needReply };
}

export async function chatSend(opts = {}) {
  const { platform: pid, log = console.log } = opts;
  const file = opts.file;
  if (!file) throw new Error('需要 --file <replies.json>');
  const replies = readJSON(file, []) || [];
  if (!replies.length) { log('回复列表为空'); return { count: 0 }; }

  const { cdp, platform } = await session(pid, { tabId: opts.tabId });
  if (platform.chatSupported === false) {
    log(`${platform.label} 不支持自动发消息`);
    cdp.close();
    return { skipped: true };
  }

  let seed = [];
  if (pid === 'liepin') seed = readJSON(opts.seed || latestDataFile('lists', 'liepin-targets'), []) || [];
  if (typeof platform.openChat === 'function' && pid === 'liepin') await platform.openChat(cdp, seed);
  else await platform.openChat(cdp);

  const out = [];
  for (const r of replies) {
    const rec = { key: r.key, verify: r.verify, text: r.text };
    try {
      const res = await platform.sendMessage(cdp, r);
      Object.assign(rec, res);
      log(`${r.key} -> ${res.result === 'sent' ? '✅ 已发送' : '⚠️ ' + res.result}`);
    } catch (e) {
      rec.result = 'error';
      rec.err = e.message;
      log(`${r.key} -> ❌ ${e.message}`);
    }
    out.push(rec);
    writeJSONAtomic(opts.out || dataPath('logs', `${pid}-chat-send`), out);
    await sleep(3200);
  }
  cdp.close();
  const sent = out.filter((r) => r.result === 'sent').length;
  log(`\n发送完成 ${sent}/${out.length}`);
  return { out, sent };
}

export const help = 'chat read|send --platform <id> [--unread-only] [--max N] [--file replies.json] [--seed list.json]';