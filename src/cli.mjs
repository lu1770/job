#!/usr/bin/env node
/**
 * 求职投递自动化 CLI
 *
 *   node src/cli.mjs login
 *   node src/cli.mjs daily --platform liepin,boss
 *   node src/cli.mjs scan  --platform boss --keywords ".NET,C#,上位机,wpf,winform,webform"
 *   node src/cli.mjs jd    --platform boss
 *   node src/cli.mjs targets --platform boss
 *   node src/cli.mjs apply --platform boss
 *   node src/cli.mjs verify --platform boss --probe
 *   node src/cli.mjs chat read  --platform boss --unread-only
 *   node src/cli.mjs chat send  --platform boss --file replies.json
 *   node src/cli.mjs history --platform boss        # 重建去重集合
 * 
 */
import { ensureDirs } from './core/io.mjs';
import { login } from './commands/login.mjs';
import { scan } from './commands/scan.mjs';
import { jd } from './commands/jd.mjs';
import { targets } from './commands/targets.mjs';
import { apply, verify } from './commands/apply.mjs';
import { chatRead, chatSend } from './commands/chat.mjs';
import { daily } from './commands/daily.mjs';
import { rebuildHistory } from './commands/history.mjs';
import { PLATFORMS, PRIORITY } from './platforms/index.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function bool(v) { return v === true || v === 'true' || v === '1'; }

const HELP = `
求职投递自动化 CLI

用法: node src/cli.mjs <命令> [选项]

命令
  login                 环境与登录态核验（只读）
  daily                 每日全流程：登录→采集→JD→清单→投递→复核→会话巡检
  scan                  多关键词采集岗位
  jd                    逐岗实读 JD，判定技术栈与年龄限制
  targets               生成最终投递清单
  apply                 批量投递（已沟通自动跳过）
  verify                复核；--probe 为只读巡检（不点击）
  chat read             读取会话（--unread-only 只读未读）
  chat send             发送回复（--file replies.json）
  history               重建跨轮次去重集合
  platforms             列出平台与关键参数

通用选项
  --platform <id>       ${Object.keys(PLATFORMS).join(' | ')}（可逗号分隔）
  --tab <id>            显式指定标签页（并行时必须）
  --keywords "a,b,c"    覆盖默认关键词
  --cap <K>             薪资上限阈值，默认 25
  --refresh <N>         每关键词采集刷新次数（全平台支持；默认 BOSS=3，其余=1，1=关闭）
  --in <file>           输入文件（scan/jd/targets/apply）
  --out <file>          输出文件
  --limit / --max N     数量上限
  --no-dedupe           跳过历史去重
  --dry                 只打印不执行（未实现的命令会提示）

平台优先级：${PRIORITY.join(' > ')}
`;

async function main() {
  ensureDirs();
  const argv = process.argv.slice(2);
  const a = parseArgs(argv);
  const cmd = a._[0];

  const base = {
    platform: a.platform,
    tabId: a.tab,
    keywords: a.keywords,
    capKMin: a.cap ? Number(a.cap) : undefined,
    refresh: a.refresh ? Number(a.refresh) : undefined,
    in: a.in,
    out: a.out,
    limit: a.limit ? Number(a.limit) : undefined,
    max: a.max ? Number(a.max) : undefined,
    dedupe: bool(a['no-dedupe']) ? false : undefined,
    seed: a.seed,
    file: a.file,
    retryLogs: a['retry-logs'],
    probe: bool(a.probe),
    unreadOnly: bool(a['unread-only']),
    show: a.show === undefined ? undefined : bool(a.show),
    skipChat: bool(a['skip-chat']),
    skipLogin: bool(a['skip-login']),
  };

  try {
    switch (cmd) {
      case 'login': return void (await login(base));
      case 'scan': return void (await scan(base));
      case 'jd': return void (await jd(base));
      case 'targets': return void (await targets(base));
      case 'apply': return void (await apply(base));
      case 'verify': return void (await verify(base));
      case 'chat': {
        const sub = a._[1] || 'read';
        if (sub === 'send') return void (await chatSend(base));
        return void (await chatRead(base));
      }
      case 'history': return void (await rebuildHistory(base));
      case 'daily': return void (await daily(base));
      case 'platforms': {
        for (const [id, p] of Object.entries(PLATFORMS)) {
          console.log(`${id.padEnd(9)} ${p.label.padEnd(12)} 关键词 ${(p.DEFAULT_KEYWORDS || []).length} 个 | 视口 ${p.VIEWPORT || 'normal'} | 节奏 ${p.pace ? p.pace.min + '-' + p.pace.max + 's' : '默认'} | 沟通 ${p.chatSupported === false ? '不支持' : '支持'}`);
        }
        return;
      }
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        return;
      default:
        console.error(`未知命令: ${cmd}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

main();