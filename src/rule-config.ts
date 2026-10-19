export const ENVIRONMENTS = {
  test: { label: '测试环境', ip: '192.168.170.88' },
  sandbox: { label: '沙箱环境', ip: '10.9.31.195' },
  local: { label: '本地环境', ip: '127.0.0.1' },
} as const;

export type Environment = keyof typeof ENVIRONMENTS;
export interface ProxyRule {
  name: string;
  enabled: boolean;
  patterns: string[];
  environment: Environment;
  machine: string;
  port?: number;
}
export interface RuleConfig {
  version: 1;
  whistle: { url: string };
  machines: string[];
  rules: ProxyRule[];
}

export function defaultConfig(): RuleConfig {
  return {
    version: 1,
    whistle: { url: 'http://127.0.0.1:8899' },
    machines: ['jacobzy', 'zhangxiaofei', 'lutong', 'nlab202608', 'sandboxjacobzy', 'sandboxzhangyuanzy'],
    rules: [
      { name: '', enabled: true, patterns: ['*/nlab_recycle_merchant', '*/u/nlab_recycle_merchant'], environment: 'test', machine: 'jacobzy' },
      { name: '', enabled: true, patterns: ['nlabstore.zhuanspirit.com', 'bmadmin.zhuanspirit.com', 'app.zhuanzhuan.com'], environment: 'test', machine: 'zhangxiaofei' },
      { name: '', enabled: true, patterns: ['*/cycling_recycle_manage', '*/u/cycling_recycle_manage'], environment: 'test', machine: 'zhangxiaofei' },
      { name: '', enabled: true, patterns: ['*/interest_consign', '*/u/interest_consign'], environment: 'test', machine: 'jacobzy' },
      { name: '', enabled: false, patterns: ['*/cycling_recycle', '*/u/cycling_recycle'], environment: 'test', machine: 'lutong' },
      { name: '', enabled: false, patterns: ['*/sale', '*/u/cyclingstore_admin_sale'], environment: 'test', machine: 'zhangxiaofei' },
      { name: '', enabled: false, patterns: ['*/nlab_recycle_merchant', '*/u/nlab_recycle_merchant'], environment: 'sandbox', machine: 'sandboxjacobzy' },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizePattern(value: unknown): string {
  if (typeof value !== 'string') throw new Error('每项请求匹配规则必须是文本。');
  const pattern = value.trim();
  if (!pattern || /[\s\u0000-\u001f\u007f#]/u.test(pattern)) {
    throw new Error('每项请求匹配规则不能为空，也不能包含空白、控制字符或 #。');
  }
  const regex = pattern.match(/^\/(.*)\/([iu]{0,2})$/u);
  if (regex) {
    try { new RegExp(regex[1], regex[2]); } catch { throw new Error('请求匹配规则的正则表达式无效。'); }
  } else {
    const target = pattern.replace(/^[!$^]+/u, '');
    if (/^[{(<@%]/u.test(target) || /^\/(?!\/)/u.test(target) || /^[a-z]:[\\/]/iu.test(target)) {
      throw new Error('请求匹配规则不能使用文件、Values 或插件操作的简写。路径请写为 */path。');
    }
    const protocol = target.match(/^([a-z][a-z\d+.-]*):\/\//iu)?.[1]?.toLowerCase();
    if (protocol && !['http', 'https', 'ws', 'wss', 'tunnel'].includes(protocol)) {
      throw new Error('请求匹配规则不能包含 Whistle 操作符；只填写域名、URL、通配符或正则。');
    }
  }
  return pattern;
}

export function normalizeMachine(value: unknown): string {
  if (typeof value !== 'string') throw new Error('测试机名称必须是文本。');
  const machine = value.trim();
  if (!machine || /[\s\u0000-\u001f\u007f#]/u.test(machine)) {
    throw new Error('测试机名称不能为空，也不能包含空白、控制字符或 #。');
  }
  return machine;
}

export function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入 Whistle 地址。');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整的 http:// 或 https:// 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Whistle 地址必须使用 HTTP 或 HTTPS，且不包含账号密码、查询参数或片段。');
  }
  return url.href.replace(/\/+$/u, '');
}

function validatePort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('本地端口必须是 1–65535 的整数。');
  }
  return value;
}

export function validateRule(value: unknown, machines: string[]): ProxyRule {
  if (!isRecord(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.patterns)) {
    throw new Error('每条规则需要 enabled、patterns 和 environment。');
  }
  if (value.name !== undefined && typeof value.name !== 'string') throw new Error('规则名称必须是文本。');
  const name = value.name === undefined ? '' : value.name.trim();
  if (value.environment !== 'test' && value.environment !== 'sandbox' && value.environment !== 'local') throw new Error('代理环境仅支持 test、sandbox 或 local。');
  const patterns = [...new Set(value.patterns.map(normalizePattern))];
  if (!patterns.length) throw new Error('每条规则至少需要一项请求匹配规则。');
  if (value.environment === 'local') {
    return { name, enabled: value.enabled, patterns, environment: value.environment, machine: '', port: validatePort(value.port) };
  }
  const machine = normalizeMachine(value.machine);
  if (!machines.includes(machine)) throw new Error('规则的测试机必须存在于 machines 列表中。');
  return { name, enabled: value.enabled, patterns, environment: value.environment, machine, ...(value.port === undefined ? {} : { port: validatePort(value.port) }) };
}

export function validateConfig(value: unknown): RuleConfig {
  if (!isRecord(value) || value.version !== 1) throw new Error('配置文件需要 version: 1。');
  if (!isRecord(value.whistle) || !Array.isArray(value.machines) || !Array.isArray(value.rules)) {
    throw new Error('配置文件缺少 whistle、machines 或 rules。');
  }
  const machines = [...new Set(value.machines.map(normalizeMachine))];
  if (!machines.length) throw new Error('至少保留一台测试机。');
  return {
    version: 1,
    whistle: { url: normalizeUrl(value.whistle.url) },
    machines,
    rules: value.rules.map((rule) => validateRule(rule, machines)),
  };
}

export function generateRules(config: RuleConfig): string {
  return config.rules.map((rule) => {
    if (rule.environment === 'local') {
      return `${rule.enabled ? '' : '# '}host://${ENVIRONMENTS.local.ip}:${rule.port} ${rule.patterns.join(' ')}`;
    }
    // Whistle expands ${name} before parsing header JSON; encode dollars to keep tags literal.
    const header = JSON.stringify({ 'Global-Route-Tag': rule.machine }).replaceAll('$', '\\u0024');
    // An explicit host operator avoids Whistle treating the environment IP as a URL pattern.
    return `${rule.enabled ? '' : '# '}host://${ENVIRONMENTS[rule.environment].ip} ${rule.patterns.join(' ')} reqHeaders://${header}`;
  }).join('\n');
}
