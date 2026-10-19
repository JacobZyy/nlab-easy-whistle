import { describe, expect, it } from 'vitest';
import { dump, JSON_SCHEMA, load } from 'js-yaml';
import { defaultConfig, generateRules, normalizeMachine, normalizePattern, normalizeUrl, validateConfig, validateRule } from '../src/rule-config';

describe('规则配置', () => {
  it('保留原始路径、多域名、各行测试机与注释状态', () => {
    const text = generateRules(defaultConfig());
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toContain('host://192.168.170.88 */nlab_recycle_merchant */u/nlab_recycle_merchant reqHeaders://{"Global-Route-Tag":"jacobzy"}');
    expect(text).toContain('host://192.168.170.88 nlabstore.zhuanspirit.com bmadmin.zhuanspirit.com app.zhuanzhuan.com reqHeaders://{"Global-Route-Tag":"zhangxiaofei"}');
    expect(text).toContain('# host://192.168.170.88 */sale */u/cyclingstore_admin_sale');
    expect(text).toContain('# host://10.9.31.195 */nlab_recycle_merchant */u/nlab_recycle_merchant reqHeaders://{"Global-Route-Tag":"sandboxjacobzy"}');
  });

  it('YAML 可往返、验证生成独立快照、空规则列表允许清理', () => {
    const source = defaultConfig();
    const restored = validateConfig(load(dump(source), { schema: JSON_SCHEMA }));
    expect(restored).toEqual(source);
    restored.rules[0]!.patterns.push('*/added');
    expect(source.rules[0]!.patterns).not.toContain('*/added');
    expect(validateConfig({ ...source, rules: [] }).rules).toEqual([]);
    expect(() => validateConfig({ ...source, version: 2 })).toThrow('version: 1');
    expect(() => validateConfig({ ...source, machines: ['missing'] })).toThrow('machines');
  });

  it('本地规则无需测试机，固定转发到 127.0.0.1 的自定义端口，YAML 往返保留端口', () => {
    const source = defaultConfig();
    const rule = validateRule({
      enabled: true,
      patterns: ['*/u/nlab-manage', '*/nlab-manage'],
      environment: 'local',
      port: 8000,
    }, source.machines);
    source.rules = [rule];
    const restored = validateConfig(load(dump(source), { schema: JSON_SCHEMA }));
    expect(restored).toEqual(source);
    expect(generateRules(restored)).toBe('host://127.0.0.1:8000 */u/nlab-manage */nlab-manage');
    restored.rules[0]!.port = 5173;
    expect(generateRules(restored)).toBe('host://127.0.0.1:5173 */u/nlab-manage */nlab-manage');
    restored.rules[0]!.enabled = false;
    expect(generateRules(restored)).toBe('# host://127.0.0.1:5173 */u/nlab-manage */nlab-manage');
  });

  it.each([1, 65535])('接受本地端口边界：%s', (port) => {
    const source = defaultConfig();
    expect(validateRule({ ...source.rules[0], environment: 'local', port }, source.machines).port).toBe(port);
  });

  it.each([undefined, null, '', '8000', 0, -1, 65536, 8000.5, NaN, Infinity, '8000 reqHeaders://x=y'])('拒绝非法本地端口：%s', (port) => {
    const source = defaultConfig();
    expect(() => validateRule({ ...source.rules[0], environment: 'local', port }, source.machines)).toThrow('本地端口必须是');
  });

  it.each(['test', 'sandbox'])('远端环境仍要求测试机：%s', (environment) => {
    const source = defaultConfig();
    expect(() => validateRule({ ...source.rules[0], environment, machine: '' }, source.machines)).toThrow('测试机名称不能为空');
    expect(() => validateRule({ ...source.rules[0], environment, machine: 'unknown' }, source.machines)).toThrow('machines');
  });

  it.each(['test', 'sandbox'])('切换到 %s 再切回本地仍保留自定义端口', (environment) => {
    const source = defaultConfig();
    const local = validateRule({ ...source.rules[0], environment: 'local', port: 5173 }, source.machines);
    const remote = validateRule({ ...local, environment, machine: source.machines[0] }, source.machines);
    expect(remote.port).toBe(5173);
    expect(generateRules({ ...source, rules: [remote] })).not.toContain(':5173');
    const restored = validateRule({ ...remote, environment: 'local' }, source.machines);
    expect(restored.port).toBe(5173);
  });

  it('旧 YAML 缺少名称时保持空白，名称往返保存但不改变 Whistle 文本', () => {
    const source = defaultConfig();
    const legacy = { ...source, rules: source.rules.map(({ name, ...rule }) => rule) };
    const restored = validateConfig(load(dump(legacy), { schema: JSON_SCHEMA }));
    expect(restored).toEqual(source);
    expect(restored.rules.every((rule) => rule.name === '')).toBe(true);
    restored.rules[0]!.name = '商户回收';
    const named = validateConfig(load(dump(restored), { schema: JSON_SCHEMA }));
    expect(named.rules[0]!.name).toBe('商户回收');
    expect(generateRules(named)).toBe(generateRules(source));
  });

  it.each([null, 123, {}])('名称不是文本时拒绝配置：%j', (name) => {
    const source = defaultConfig();
    expect(() => validateConfig({ ...source, rules: [{ ...source.rules[0], name }] })).toThrow('规则名称必须是文本');
  });

  it.each(['*/one */two', '*/one\n*/two', '*/one#comment', 'host://127.0.0.1', 'reqHeaders://{"X":"Y"}', '^file://test', '/etc/passwd', '/foo/g', '{valueKey}', '(inlineBody)', '<local-file>', '@https://example.com', '%plugin.key=value', 'C:\\local-file'])('拒绝规则文本注入：%s', (pattern) => {
    expect(() => normalizePattern(pattern)).toThrow();
  });

  it.each(['*/u/merchant', 'https://app.zhuanzhuan.com/api/thing', 'app.zhuanzhuan.com', '/https?:\\/\\/[^/]+\\/api/i', '!*/excluded', '//domain.example/path', '127.0.0.1'])('接受匹配模式：%s', (pattern) => {
    expect(normalizePattern(pattern)).toBe(pattern);
  });

  it('标签保持字面值，拒绝 Whistle 注释与空白', () => {
    const config = defaultConfig();
    config.rules = [{ ...config.rules[0]!, machine: '${machine}\\"tag' }];
    const text = generateRules(config);
    expect(text).not.toContain('${machine}');
    expect(JSON.parse(text.split('reqHeaders://')[1]!)).toEqual({ 'Global-Route-Tag': '${machine}\\"tag' });
    expect(() => normalizeMachine('a#b')).toThrow();
    expect(() => normalizeMachine('a b')).toThrow();
  });

  it('仅允许无凭据、无查询参数的 HTTP 地址', () => {
    expect(normalizeUrl(' http://127.0.0.1:8899/ ')).toBe('http://127.0.0.1:8899');
    for (const url of ['file:///tmp/', 'http://user:pass@localhost/', 'http://localhost/?token=x', 'http://localhost/#x']) {
      expect(() => normalizeUrl(url)).toThrow();
    }
  });
});
