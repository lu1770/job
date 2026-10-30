/**
 * 城市注册表：把「城市中文名」映射成各平台搜索 URL 里的编码，
 * 并给 cityOk/normalize 提供地名匹配规则。
 *
 * 为什么不写在各平台里：BOSS/猎聘/51job/智联/鱼泡每个平台都
 * 有自己的城市编码体系（字符串 + 数字混合、长度不一），跨平台
 * 统一起来用户才能 `--city 上海` 一行命令串起所有平台。
 *
 * 编码来源：从各平台「切换城市」下拉框 URL 实测抄录。如果目标
 * 城市缺失（比如 `--city 成都`）会直接报错并提示已支持的列表。
 *
 * 新增城市流程：
 *  1. 浏览器打开目标平台搜索页；
 *  2. 右上角切到目标城市，地址栏里 `city=xxx` / `dq=xxx` / `jl=xxx` / `jobArea=xxx` / `/topic/aNNNc0/` 里的值就是该平台编码；
 *  3. 在下方 CITIES 里加一行，正则写 /城市名/ 即可（若有下辖市/区，照苏州那样补 alias 字段）。
 */

/** 各平台编码字段名（供 searchUrl 拼装 URL 查询串时用） */
export const PLATFORM_CITY_KEY = {
  boss: 'city',          // city=101190400
  liepin: 'dq',          // dq=060080
  job51: 'jobArea',      // jobArea=070300
  zhaopin: 'jl',         // jl=639
  yupaopin: 'area',      // 不是查询串，是路径段 /topic/a221c0/
};

/**
 * 城市注册表（编码全是实测抄录，勿凭常识改）。
 *
 * 字段：
 *  - label     城市中文名（用户传 --city 的值，匹配不分大小写，允许「市」尾缀）
 *  - regex     城市匹配正则（给 cityOk / normalize 用），默认 /城市名/；若有下辖市/区，
 *              用 alias 数组列出，自动合并成 /城市名|alias1|alias2|.../ 形式
 *  - alias     （可选）下辖市/区的裸写法（如昆山市、常熟市），鱼泡这类区域只写裸名的平台需要
 *  - boss      BOSS 城市编码
 *  - liepin    猎聘 dq 编码
 *  - job51     51job jobArea 编码
 *  - zhaopin   智联 jl 编码
 *  - yupaopin  鱼泡站点编码（路径段，不带 c0 分类后缀）
 */
export const CITIES = [
  {
    label: '苏州',
    alias: ['昆山', '常熟', '张家港', '太仓'],
    boss: '101190400',
    liepin: '060080',
    job51: '070300',
    zhaopin: '639',
    yupaopin: 'a221',
  },
  {
    label: '上海',
    alias: ['浦东', '徐汇', '静安', '黄浦', '长宁', '普陀', '虹口', '杨浦', '闵行', '宝山', '嘉定', '松江', '金山', '青浦', '奉贤', '崇明'],
    boss: '101020100',
    liepin: '020200',
    job51: '020200',
    zhaopin: '538',
    yupaopin: 'a220',
  },
  {
    label: '北京',
    boss: '101010100',
    liepin: '010100',
    job51: '010200',
    zhaopin: '530',
    yupaopin: 'a210',
  },
  {
    label: '杭州',
    boss: '101210100',
    liepin: '070200',
    job51: '080200',
    zhaopin: '653',
    yupaopin: 'a230',
  },
  {
    label: '南京',
    boss: '101190100',
    liepin: '060020',
    job51: '070200',
    zhaopin: '635',
    yupaopin: 'a222',
  },
  {
    label: '深圳',
    boss: '101280600',
    liepin: '040200',
    job51: '040200',
    zhaopin: '763',
    yupaopin: 'a250',
  },
];

/** 默认城市 —— 不传 --city 时用这个 */
export const DEFAULT_CITY = '苏州';

/** 按中文名查（不分大小写，尾部「市」可省略） */
export function resolveCity(name) {
  if (!name) return resolveCity(DEFAULT_CITY);
  const norm = String(name).trim().replace(/市$/, '').toLowerCase();
  return CITIES.find((c) => c.label.toLowerCase() === norm) || null;
}

/** 该城市在指定平台的编码（找不到直接抛错，避免静默用错城市） */
export function cityCodeFor(cityName, platformId) {
  const c = resolveCity(cityName);
  if (!c) throw new Error(`未支持的城市：${cityName}（已支持：${CITIES.map((x) => x.label).join('、')}）`);
  const code = c[platformId];
  if (!code) throw new Error(`城市 ${c.label} 在平台 ${platformId} 上没有编码，请补进 src/core/city.mjs`);
  return code;
}

/** 该城市的地名匹配正则（cityOk / normalize 共用） */
export function cityRegex(cityName) {
  const c = resolveCity(cityName);
  if (!c) return /./;
  const names = [c.label, ...(c.alias || [])];
  return new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

/** 列出所有已支持城市（platforms 命令用） */
export function listCities() { return CITIES.map((c) => c.label); }

/**
 * 构造平台 homeUrl（按城市切换）。
 * 各平台适配器内部 export const homeUrl 仍保留默认值（苏州），
 * 需要按城市开新标签时统一走这里。
 */
export function homeUrlFor(platformId, cityName = DEFAULT_CITY) {
  const c = resolveCity(cityName) || resolveCity(DEFAULT_CITY);
  switch (platformId) {
    case 'boss': return 'https://www.zhipin.com/web/geek/chat';
    case 'liepin': return 'https://www.liepin.com/zhaopin/';
    case 'job51': return 'https://we.51job.com/pc/my/myjob';
    case 'zhaopin': return `https://www.zhaopin.com/jobs?jl=${c.zhaopin}&kw=.NET`;
    case 'yupaopin': return `https://www.yupao.com/${c.yupaopin}/`;
    default: return 'about:blank';
  }
}
