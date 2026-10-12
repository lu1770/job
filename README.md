# 求职投递自动化（job-apply-automation）

BOSS 直聘 / 猎聘 / 智联招聘 / 前程无忧 51job 的批量搜索与投递流水线。
**零第三方依赖**，直接用 Node 内置 WebSocket 驱动原生 CDP。

> 2026-10-10 由 88 个一次性脚本重构而来：代码与数据分离、重复功能合并为 4 层架构。
> 旧脚本见 `legacy/MAPPING.md`（含合并映射）。

---

## 快速开始

```bash
node src/cli.mjs platforms              # 查看平台与参数
node src/cli.mjs login                  # 环境 + 四平台登录态核验（只读）
node src/cli.mjs daily --platform liepin,boss   # 每日全流程
```

> Windows 注意事项：环境变量 `HTTP_PROXY` 会劫持本地 CDP 请求，所有命令需带
> `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost`。

## 目录结构

```
job/
├─ config/            配置（口径/屏蔽名单，改这里不动代码）
│  ├─ blocklist.json    公司屏蔽名单（子串匹配）
│  └─ criteria.json     薪资阈值、相关性正则、管理岗排除
├─ src/
│  ├─ cli.mjs           统一入口
│  ├─ core/             与业务无关的底座
│  │  ├─ cdp.mjs         CDP 连接 / 求值 / 导航 / 真人化鼠标键盘 / 可见性
│  │  ├─ session.mjs     平台 + 标签页 + 视口 打包
│  │  ├─ io.mjs          数据路径与原子落盘
│  │  ├─ salary.mjs      薪资解析（K/万/年/元 统一）
│  │  ├─ criteria.mjs    屏蔽名单 / 标题相关性 / 技术栈 / 年龄限制
│  │  ├─ age.mjs         年龄限制探测器
│  │  └─ dedupe.mjs      跨轮次去重集合
│  ├─ platforms/        平台适配器（唯一知道 DOM 选择器的地方）
│  │  ├─ boss.mjs  liepin.mjs  job51.mjs  zhaopin.mjs  index.mjs
│  └─ commands/         业务流程（跨平台复用）
│     ├─ login.mjs  scan.mjs  jd.mjs  targets.mjs
│     ├─ apply.mjs（含 verify / --probe）  chat.mjs  history.mjs  daily.mjs
├─ data/               运行产物
│  ├─ raw/ work/ lists/ logs/ history/
├─ reports/            日报与报告
└─ legacy/             旧脚本归档（勿改）
```

## 平台定位模型（两种，别混用）

| 模型 | 平台 | normalize 产出 | apply 路径 |
|---|---|---|---|
| `detailStrategy: 'url'`（默认） | BOSS / 猎聘 / 51job | `url` + `id` | 导航详情页 → 点按钮 |
| `detailStrategy: 'panel'` | **智联** | `cardIndex` + `cardKey`，**无 url** | 回搜索页 → 点卡片 → 右侧详情面板 |

**智联为什么没有 URL**：实测 `.job-card` 卡片里唯一的 `<a>` 是公司页 `companydetail/CZxxxx.htm`，
不存在 `/jobdetail/<id>` 这类链接。早期用正则 `/jobdetail\/(\d+)/` 抠 ID，结果长期恒为 0 ——
不是正则写错，而是这个平台上根本不存在这种 URL。

因此：
- `normalize()` 返回 `cardKey`（`标题|薪资|公司` 指纹）作为 `id`，`url` 留空；
- 去重走 `dedupe.mjs` 的 `keyOf`，不依赖 URL（`commands/history.mjs` 里 `idRe: null`）；
- 定位靠**标题匹配 + 面板标题复核**（卡片序号每次加载都会漂移，序号只作兜底）；
- JD 正文只从 `.job-detail-modules__detail` 读 —— 读整页会把推荐位/页脚关键词全命中，导致每个岗位看起来都像 .NET。

新增平台若卡片里没有详情链接，就用 `detailStrategy = 'panel'` + `cardKey`。

## URL / ID 解析工具（`src/core/url.mjs`）

```js
absUrl(href, base)          // 相对 / 协议相对 / 缺 scheme → 绝对 URL；取不到返回 null
jobIdFrom(url, {patterns})  // 多模式依次尝试 → 最后一段有效路径兜底 → 取不到返回 null
fingerprint({title,company,salary})  // 无 URL 平台的稳定去重键
```

约定：**取不到就返回 `null`，绝不返回半截字符串**；调用方据此切换到指纹去重或面板模型。

## 分层约定

1. **core/** 不含任何平台选择器；
2. **platforms/** 只做「页面 ↔ 结构化数据」的翻译，外加 `applyOne` / `sendMessage` / `readConversation`；
3. **commands/** 只做编排：筛选、节奏、落盘、熔断、汇总；
4. 新增平台 = 新增一个 `platforms/xxx.mjs` 并在 `index.mjs` 注册，流水线零改动。

## 命令参考

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `login` | CDP 可达性 + 登录态（只读） | `--platform` |
| `scan` | 多关键词采集，逐关键词容错 + 增量落盘 | `--keywords` `--cap` |
| `jd` | 逐岗实读 JD，判定技术栈/年龄限制 | `--in` `--no-dedupe` `--limit` |
| `targets` | 生成最终投递清单 + 剔除原因统计 | `--in` |
| `apply` | 批量投递（已沟通自动跳过） | `--in` `--retry-logs` |
| `verify` | 复核；`--probe` 为只读巡检不点击 | `--in` `--probe` |
| `chat read` | 会话巡检，`--unread-only` 只读未读 | `--max` |
| `chat send` | 发回复（校验会话后才发） | `--file` |
| `history` | 重建去重集合 | `--platform` |
| `daily` | 全流程编排 | `--platform` `--skip-chat` |

## 业务铁律（写进代码，勿绕过）

1. **绝不调用 `Runtime.enable` / `Page.enable` / `DOM.enable`** —— 反爬头号指纹，会被秒关标签页。
2. **投递点击方式按平台区分**：BOSS/猎聘/智联只认 **JS click**；51job 相反，必须**真实鼠标**。
3. **窗口最小化会让所有真实鼠标点击静默失效** → `session()` 已强制 `Emulation.setFocusEmulationEnabled` + 视口覆盖。
4. **本机 OS 缩放 150%**：实际 CSS 视口 = 设定值 ÷ 1.5，51job 必须用 `wide(2400×1500)`。
5. **验证码/滑块/短信验证绝不绕过**，一律停下交人工。
6. **已投判据必须精确读按钮文本**：BOSS `a.btn-startchat` = `立即沟通`/`继续沟通`；
   猎聘 = `聊一聊`/`继续聊`。页面正文里的「沟通过/已投递」字样来自推荐位，**不可作判据**。
7. **额度与风控熔断**：BOSS 当日沟通 150 次上限，触顶弹「温馨提示」且点击失效；
   猎聘约 120 次详情页访问触发「账号行为异常」。两者命中即停该平台。
8. **沟通口径**：只回实质提问；客套与婉拒不回；遇授权卡（简历/联系方式/微信）先索要 JD，绝不代点。

## 扩展配置

改 `config/criteria.json` 即可调整口径，无需改代码：

```jsonc
{
  "capKMin": 25,              // 薪资上限阈值（K = 千/月）
  "requireDotNetInJd": true,  // 强制 JD 实证 C#/.NET 栈
  "exclude": ["c\\+\\+|cpp|\\bqt\\b|...", "..."]   // 全部按大小写不敏感编译
}
```