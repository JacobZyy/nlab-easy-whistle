export const ENVIRONMENTS = {
  test: { label: '测试环境', ip: '192.168.170.88' },
  sandbox: { label: '沙箱环境', ip: '10.9.31.195' },
};

export function defaultConfig() {
  return {
    version: 1,
    whistle: { url: 'http://127.0.0.1:8899' },
    machines: ['jacobzy', 'zhangxiaofei', 'lutong', 'nlab202608', 'sandboxjacobzy', 'sandboxzhangyuanzy'],
    rules: [
      { enabled: true, patterns: ['*/nlab_recycle_merchant', '*/u/nlab_recycle_merchant'], environment: 'test', machine: 'jacobzy' },
      { enabled: true, patterns: ['nlabstore.zhuanspirit.com', 'bmadmin.zhuanspirit.com', 'app.zhuanzhuan.com'], environment: 'test', machine: 'zhangxiaofei' },
      { enabled: true, patterns: ['*/cycling_recycle_manage', '*/u/cycling_recycle_manage'], environment: 'test', machine: 'zhangxiaofei' },
      { enabled: true, patterns: ['*/interest_consign', '*/u/interest_consign'], environment: 'test', machine: 'jacobzy' },
      { enabled: false, patterns: ['*/cycling_recycle', '*/u/cycling_recycle'], environment: 'test', machine: 'lutong' },
      { enabled: false, patterns: ['*/sale', '*/u/cyclingstore_admin_sale'], environment: 'test', machine: 'zhangxiaofei' },
      { enabled: false, patterns: ['*/nlab_recycle_merchant', '*/u/nlab_recycle_merchant'], environment: 'sandbox', machine: 'sandboxjacobzy' },
    ],
  };
}

export function normalizePattern(value) {
  if (typeof value !== 'string' || /[\r\n]/u.test(value)) throw new Error('每项通配符必须是单行文本。');
  const pattern = value.trim();
  if (!pattern) throw new Error('请输入通配符。');
  return pattern;
}

export function normalizeMachine(value) {
  if (typeof value !== 'string') throw new Error('测试机名称必须是文本。');
  const machine = value.trim();
  if (!machine || /[\s\u0000-\u001f\u007f]/u.test(machine)) throw new Error('测试机名称不能为空，也不能包含空白或控制字符。');
  return machine;
}

export function normalizeUrl(value) {
  if (typeof value !== 'string') throw new Error('请输入 Whistle 地址。');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请输入完整的 http:// 或 https:// 地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Whistle 地址必须使用 HTTP 或 HTTPS，且不包含账号密码。');
  return value.trim();
}

export function validateRule(value, machines) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.patterns)) {
    throw new Error('每条规则需要 enabled、patterns、environment 和 machine。');
  }
  if (!Object.hasOwn(ENVIRONMENTS, value.environment)) throw new Error('代理环境仅支持 test 或 sandbox。');
  const patterns = [...new Set(value.patterns.map(normalizePattern))];
  if (!patterns.length) throw new Error('每条规则至少需要一项通配符。');
  const machine = normalizeMachine(value.machine);
  if (!machines.includes(machine)) throw new Error('规则的测试机必须存在于 machines 列表中。');
  return { enabled: value.enabled, patterns, environment: value.environment, machine };
}

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) throw new Error('配置文件需要 version: 1。');
  if (!value.whistle || !Array.isArray(value.machines) || !Array.isArray(value.rules)) throw new Error('配置文件缺少 whistle、machines 或 rules。');
  const machines = [...new Set(value.machines.map(normalizeMachine))];
  if (!machines.length) throw new Error('至少保留一台测试机。');
  return {
    version: 1,
    whistle: { url: normalizeUrl(value.whistle.url) },
    machines,
    rules: value.rules.map((rule) => validateRule(rule, machines)),
  };
}

export function generateRules(config) {
  return config.rules.map((rule) => {
    const header = JSON.stringify({ 'Global-Route-Tag': rule.machine });
    return `${rule.enabled ? '' : '# '}${ENVIRONMENTS[rule.environment].ip} ${rule.patterns.join(' ')} reqHeaders://${header}`;
  }).join('\n');
}
