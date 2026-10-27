# 求职投递自动化（job-apply-automation）

BOSS 直聘 / 猎聘 / 智联招聘 / 前程无忧 51job / **鱼泡直聘** 的批量搜索与投递流水线。

**零第三方依赖**，直接用 Node 内置 WebSocket 驱动原生 CDP。

> 2026-10-10 由 88 个一次性脚本重构而来：代码与数据分离、重复功能合并为 4 层架构。
> 旧脚本见
> `legacy/MAPPING.md`
> （含合并映射）。
> 2026-10-13 新增鱼泡直聘（
> `platforms/yupaopin.mjs`
> ）。



***

## 快速开始



```
node src/cli.mjs platforms              # 查看平台与参数
node src/cli.mjs login                  # 环境 + 四平台登录态核验（只读）
node src/cli.mjs daily --platform liepin,boss   # 每日全流程
```

> Windows 注意事项：环境变量
> `HTTP_PROXY`
> 会劫持本地 CDP 请求，所有命令需带
> `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost`
> 。

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
│  │  ├─ pagejs.mjs      页面内 JS 表达式生成器（会话定位 / 滚动，选择器由平台传入）
│  │  ├─ readjd.mjs      JD 读取工厂（标题+正文 → techFlags/年龄判定，各平台共用）
│  │  ├─ multiscan.mjs   多轮刷新采集合并（全平台 scanKeyword 共用，零新增即提前结束）
│  │  └─ dedupe.mjs      跨轮次去重集合
│  ├─ platforms/        平台适配器（唯一知道 DOM 选择器的地方）
│  │  ├─ boss.mjs  liepin.mjs  job51.mjs  zhaopin.mjs  yupaopin.mjs  index.mjs
│  └─ commands/         业务流程（跨平台复用）
│     ├─ login.mjs  scan.mjs  jd.mjs  targets.mjs
│     ├─ apply.mjs（含 verify / --probe）  chat.mjs  history.mjs  daily.mjs  keywords.mjs
├─ data/               运行产物
│  ├─ raw/ work/ lists/ logs/ history/
├─ reports/            日报与报告
└─ legacy/             旧脚本归档（勿改）
```

## 平台定位模型（两种，别混用）



| 模型                          | 平台                         | normalize 产出                      | apply 路径            |
| --------------------------- | -------------------------- | --------------------------------- | ------------------- |
| `detailStrategy: 'url'`（默认） | BOSS / 猎聘 / 51job / **鱼泡** | `url` + `id`                      | 导航详情页 → 点按钮         |
| `detailStrategy: 'panel'`   | **智联**                     | `cardIndex` + `cardKey`，**无 url** | 回搜索页 → 点卡片 → 右侧详情面板 |

**智联为什么没有 URL**：实测 `.job-card` 卡片里唯一的 `<a>` 是公司页 `companydetail/CZxxxx.htm`，

不存在 `/jobdetail/<id>` 这类链接。早期用正则 `/jobdetail\/(\d+)/` 抠 ID，结果长期恒为 0 ——

不是正则写错，而是这个平台上根本不存在这种 URL。

因此：



* `normalize()` 返回 `cardKey`（`标题|薪资|公司` 指纹）作为 `id`，`url` 留空；

* 去重走 `dedupe.mjs` 的 `keyOf`，不依赖 URL（`commands/history.mjs` 里 `idRe: null`）；

* 定位靠**标题匹配 + 面板标题复核**（卡片序号每次加载都会漂移，序号只作兜底）；

* JD 正文只从 `.job-detail-modules__detail` 读 —— 读整页会把推荐位 / 页脚关键词全命中，导致每个岗位看起来都像 .NET。

新增平台若卡片里没有详情链接，就用 `detailStrategy = 'panel'` + `cardKey`。

## 鱼泡直聘（2026-10-13 新增）



```
node src/cli.mjs login --platform yupaopin
node src/cli.mjs scan  --platform yupaopin --keywords ".NET,C#,上位机"
node src/cli.mjs verify --platform yupaopin --probe    # 只读巡检，不点击
```

与另外四个平台不同的几件事：



1. **有阿里云 WAF + 滑块验证**。`curl` 只能拿到 4.8KB 挑战页（HTML 里没有任何职位内容），

   本适配器**只能走 CDP 真实浏览器**。且**详情页连着访问约 5 次即触发滑块**，

   滑块页正文是「访问验证 / 请按住滑块，拖动到最右边」（标题才是「滑动验证页面」，

   按 `滑动验证` 判会漏检 → 误报 `no_btn`），命中即停，约几分钟自行过期。

2. **class 名每次构建都重新混淆**（实测 `acccc` / `accch` / `ahea` / `agbe`…）。

   因此适配器内**不写任何 class 选择器**，一律语义定位：

* 卡片锚点 = **公司链接&#x20;**`/qiye/<id>.html`（每张卡片恰好一个），

  从它向上找到「1 个 `/qiye/` + ≤1 个 `/zhaogong/` + 高度 90\~420 + 文本含『元 /』」的容器 = 整卡。

  （从详情链接向上找会切到半张卡，实测过。）

* 卡片文本行序固定：行 0 = 标题、行 1 = 薪资，其后为标签 / 公司 /**区域**。

  区域要取「公司名的下一行」—— 实测 40% 只写裸「苏州」，用正则猜地名会漏，

  而 `cityOk()` 靠它判城市，漏了会被整批误杀。`normalizeLoc()` 会给

  `昆山市`/`常熟市` 这类下辖市补上「苏州・」前缀，否则同样被误判成非苏州。

1. **URL 里的 token 每次都变**：详情页是 `/zhaogong/{数字ID}/{随机token}.html`，

   去重只能用**数字 ID**。各适配器统一导出 `ID_RE`（`scan.mjs` / `history.mjs` 都从这里取，

   不要在命令层再写一份正则）。鱼泡的是 `/(?:yupao\.com)?\/zhaogong\/(\d+)/` ——

   **必须只捕获数字段**（写 `(.+)` 会把随机 token 当成岗位 ID，去重直接失效），

   host 部分做成可选是因为采集产物里 `href` 是站内相对路径。

   token 失效会跳「页面找不到啦」→ `result = not_found`。

2. **薪资需要适配器归一化**：详情页写作 `8千-1.2万/月`，

   `core/salary.mjs` 解析为 **0**（会让所有高薪岗被 25K 阈值误杀），

   故 `normalize()` 先把区间两端各自换算成「元 / 月」再交给 core 复算；

   且鱼泡常只在一端带单位（`1-1.2万`），另一端必须继承，否则上限算成 0.12K。

3. **岗位招满会撤掉投递按钮**，只在标题区留「已招满」→ `result = closed`，

   不进重投名单（`apply.mjs` 的 `bad` 集合里没有 `closed`）。

列表是**纯滚动懒加载、无翻页按钮**（实测 6 次滚动 16→105 条）。

详情页有**两个「发送简历」**（主区 + 「相同职位推荐」区，后者在视口外 y=-1382），

按钮定位统一加「视口内 + `elementFromPoint` 未被遮挡」双条件，防误点推荐位。

登录态判据：右上角「登录丨注册」= 游客；「消息 / 简历 / 路正遥」= 已登录（本机实测已登录）。

`chatSupported = false` —— PC 端消息中心能力未验证，登录后需补适配。

实测：`scan --keywords "上位机,WPF,WinForm"` → 153 岗 / 55 个 ≥25K；

`jd --limit 6` → 6 条全部识别出 dotnet・wpf・upper・motion・mes；

`targets` → 入选 5、剔除 1（「固件开发工程师」被嵌入式规则正确拦下）；

`verify --probe` → 5 条全部返回真实状态（2 条 `closed:已招满`、3 条 `ready:发送简历`）。

## URL / ID 解析工具（`src/core/url.mjs`）



```
absUrl(href, base)          // 相对 / 协议相对 / 缺 scheme → 绝对 URL；取不到返回 null
jobIdFrom(url, {patterns})  // 多模式依次尝试 → 最后一段有效路径兜底 → 取不到返回 null
fingerprint({title,company,salary})  // 无 URL 平台的稳定去重键
```

约定：**取不到就返回&#x20;**`null`**，绝不返回半截字符串**；调用方据此切换到指纹去重或面板模型。

## 分层约定



1. **core/** 不含任何平台选择器；

2. **platforms/** 只做「页面 ↔ 结构化数据」的翻译，外加 `applyOne` / `sendMessage` / `readConversation`；

3. **commands/** 只做编排：筛选、节奏、落盘、熔断、汇总；

4. **新增平台 = 新增一个&#x20;**`platforms/xxx.mjs`**&#x20;并在&#x20;**`index.mjs`**&#x20;注册**，流水线零改动。

   适配器接口：`id, label, DEFAULT_KEYWORDS, ID_RE, searchUrl?(kw), scanKeyword(cdp,kw),`

   `normalize?(items), readJd(cdp), applyOne(cdp,item), probeItem?(cdp,item),`

   `guard?(cdp), pace?, VIEWPORT?, chatSupported?`。

   `ID_RE` 是岗位 ID 正则的唯一来源，命令层不许再写平台专属正则。

## 命令参考



| 命令          | 作用                                             | 常用参数                           |
| ----------- | ---------------------------------------------- | ------------------------------ |
| `login`     | CDP 可达性 + 登录态（只读）                              | `--platform`                   |
| `scan`      | 多关键词采集，逐关键词容错 + 增量落盘                           | `--keywords` `--cap`           |
| `jd`        | 逐岗实读 JD，判定技术栈 / 年龄限制                           | `--in` `--no-dedupe` `--limit` |
| `targets`   | 生成最终投递清单 + 剔除原因统计                              | `--in`                         |
| `apply`     | 批量投递（已沟通自动跳过）                                  | `--in` `--retry-logs`          |
| `verify`    | 复核；`--probe` 为只读巡检不点击                          | `--in` `--probe`               |
| `chat read` | 会话巡检，`--unread-only` 只读未读                      | `--max`                        |
| `chat send` | 发回复（校验会话后才发）                                   | `--file`                       |
| `history`   | 重建去重集合                                         | `--platform`                   |
| `daily`     | 全流程编排（末尾自动跑关键词排行；不传 `--keywords` 时沿用上一日 Top10） | `--platform` `--skip-chat`     |
| `keywords`  | 当日 JD 关键词排行（只读，不去浏览器）                          | `--date` `--top` `--out`       |

## 业务铁律（写进代码，勿绕过）



1. **绝不调用&#x20;**`Runtime.enable`**&#x20;/&#x20;**`Page.enable`**&#x20;/&#x20;**`DOM.enable` —— 反爬头号指纹，会被秒关标签页。

2. **投递点击方式按平台区分**：BOSS / 猎聘 / 智联 / 鱼泡只认 **JS click**；51job 相反，必须**真实鼠标**。

3. **窗口最小化会让所有真实鼠标点击静默失效** → `session()` 已强制 `Emulation.setFocusEmulationEnabled` + 视口覆盖。

4. **本机 OS 缩放 150%**：实际 CSS 视口 = 设定值 ÷ 1.5，51job / 鱼泡必须用 `wide(2400×1500)`。

5. **验证码 / 滑块 / 短信验证绝不绕过**，一律停下交人工。

6. **已投判据必须精确读按钮文本**：BOSS `a.btn-startchat` = `立即沟通`/`继续沟通`；

   猎聘 = `聊一聊`/`继续聊`；鱼泡 = `发送简历`/`继续聊`。页面正文里的「沟通过 / 已投递」字样来自推荐位，**不可作判据**。

7. **额度与风控熔断**：BOSS 当日沟通 150 次上限，触顶弹「温馨提示」且点击失效；

   猎聘约 120 次详情页访问触发「账号行为异常」。两者命中即停该平台。

   鱼泡详情页连访约 5 次即触发阿里云滑块（`result = 'slider_blocked'`），命中即停；

   `acw_sc__v2` 挑战页则 `result = 'waf_blocked'`。`waf_blocked`**&#x20;/&#x20;**`login_wall`**&#x20;都已在熔断名单里**，

   否则每条都在被拦时白跑一遍详情页。

8. **沟通口径**：只回实质提问；客套与婉拒不回；遇授权卡（简历 / 联系方式 / 微信）先索要 JD，绝不代点。

9. **不写 class 选择器，除非该平台 class 不混淆**。鱼泡每次构建重新混淆 class，

   用 `acccc` 这类名字写选择器等于埋雷；一律走 href 形态 + 文本 + 几何尺寸的语义定位。

10. **区分「业务上投不了」和「技术上没找到」**。鱼泡招满 → `closed`；

    不收简历 → `chat_only`；token 失效 → `not_found`；被滑块拦 → `slider_blocked`。

    前三者若都笼统报 `no_btn`，`apply.mjs` 会把它们塞进重投名单反复空转。

    反过来，`closed`/`chat_only` 是**业务终态**，不该计入 `fail` 拉低成功率 ——

    `apply.mjs` 用 `SKIP_RESULTS` 单独归到 `skipped`。

11. **点击后必须轮询复核，不能固定等一次**。鱼泡投递成功后按钮 3\~8s 才变「继续聊」，

    等 2.2s 读一次会把成功误判成 `unknown`（实战 5 条 unknown 里复检发现 2 条早已成功）。

## 判据链单测（不依赖浏览器）

页面 JS 表达式（按钮定位、薪资解析）最容易在改版时悄悄改坏，且不好靠肉眼发现。

`scripts/test_yupaopin_btns.mjs` 把 `yupaopin.mjs` 里的 `APPLY_BTN` 表达式抠出来，

在 Node 里喂模拟 DOM 跑判据链：



```
node scripts/test_yupaopin_btns.mjs   # 13 例：两套文案/视口外/被遮挡/尺寸/已招满/未登录…
```

新增平台若判据复杂，照这个模式补一个同结构的单测。

## 扩展配置

改 `config/criteria.json` 即可调整口径，无需改代码：



```
{
  "capKMin": 25,              // 薪资上限阈值（K = 千/月）
  "requireDotNetInJd": true,  // 强制 JD 实证 C#/.NET 栈
  "exclude": ["c\\+\\+|cpp|\\bqt\\b|...", "..."]   // 全部按大小写不敏感编译
}
```