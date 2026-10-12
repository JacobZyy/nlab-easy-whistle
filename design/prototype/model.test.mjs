import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, generateRules, normalizeMachine, normalizePattern, normalizeUrl, validateConfig, validateRule } from './model.mjs';

test('规则组独立使用环境与机器，禁用组保留原规则并加注释', () => {
  const config = defaultConfig();
  const lines = generateRules(config).split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[0], '192.168.170.88 */nlab_recycle_merchant */u/nlab_recycle_merchant reqHeaders://{"Global-Route-Tag":"jacobzy"}');
  assert.equal(lines[1], '192.168.170.88 nlabstore.zhuanspirit.com bmadmin.zhuanspirit.com app.zhuanzhuan.com reqHeaders://{"Global-Route-Tag":"zhangxiaofei"}');
  assert.equal(lines[5], '# 192.168.170.88 */sale */u/cyclingstore_admin_sale reqHeaders://{"Global-Route-Tag":"zhangxiaofei"}');
  assert.equal(lines[6], '# 10.9.31.195 */nlab_recycle_merchant */u/nlab_recycle_merchant reqHeaders://{"Global-Route-Tag":"sandboxjacobzy"}');
  config.rules[0].machine = 'machine"1';
  assert.ok(generateRules(config).includes('"Global-Route-Tag":"machine\\"1"'));
  config.rules = [];
  assert.equal(generateRules(config), '');
});

test('导入校验规则组，去重且保留单行匹配内容原样', () => {
  const config = defaultConfig();
  config.rules[0].patterns = ['  */path?foo=*  ', '*/path?foo=*', '^https://example.test/[a-z]+$'];
  config.machines.push(' jacobzy ');
  const normalized = validateConfig(config);
  assert.deepEqual(normalized.rules[0].patterns, ['*/path?foo=*', '^https://example.test/[a-z]+$']);
  assert.equal(normalized.machines.length, 6);
  assert.throws(() => validateConfig({ ...config, version: 2 }), /version: 1/u);
  assert.throws(() => validateConfig({ ...config, machines: [] }), /至少/u);
  assert.throws(() => validateRule({ ...config.rules[0], environment: 'prod' }, config.machines), /test 或 sandbox/u);
  assert.throws(() => validateRule({ ...config.rules[0], machine: 'missing' }, config.machines), /machines/u);
  assert.throws(() => validateRule({ ...config.rules[0], enabled: 'true' }, config.machines), /enabled/u);
  assert.throws(() => validateRule({ ...config.rules[0], patterns: [] }, config.machines), /至少/u);
  assert.throws(() => normalizePattern('*/path\n*/another'), /单行/u);
  assert.throws(() => normalizePattern('  '), /请输入/u);
  assert.throws(() => normalizeMachine('machine\r\nheader'), /空白/u);
  assert.throws(() => normalizeUrl('file:///tmp/rules'), /HTTP/u);
  assert.throws(() => normalizeUrl('http://user:secret@127.0.0.1:8899'), /账号密码/u);
  assert.equal(normalizeUrl(' https://localhost:8899 '), 'https://localhost:8899');
});
