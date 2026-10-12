import { describe, expect, it } from 'vitest';
import { defaultConfig, generateRules } from '../src/rule-config';
import { tokenizeRule } from '../src/rule-highlight';

describe('规则文本高亮', () => {
  it('区分代理操作符、地址、JSON 键和值，保留匹配规则与标点', () => {
    expect(tokenizeRule('host://192.168.170.88 */merchant reqHeaders://{"Global-Route-Tag":"jacobzy"}')).toEqual([
      { text: 'host://', kind: 'operator' },
      { text: '192.168.170.88', kind: 'address' },
      { text: ' */merchant ', kind: 'plain' },
      { text: 'reqHeaders://', kind: 'operator' },
      { text: '{', kind: 'plain' },
      { text: '"Global-Route-Tag"', kind: 'key' },
      { text: ':', kind: 'plain' },
      { text: '"jacobzy"', kind: 'string' },
      { text: '}', kind: 'plain' },
    ]);
  });

  it('禁用规则整行作为注释，空文本返回空数组', () => {
    const comment = '# host://10.9.31.195 */merchant reqHeaders://{"Global-Route-Tag":"sandboxjacobzy"}';
    expect(tokenizeRule(comment)).toEqual([{ text: comment, kind: 'comment' }]);
    expect(tokenizeRule('')).toEqual([]);
  });

  it('JSON 转义、HTML 字面值和字符串中的操作符不被拆开', () => {
    const config = defaultConfig();
    config.rules = [{ ...config.rules[0]!, patterns: ['https://example.com/host://10.9.31.195/reqHeaders://'], machine: 'host://10.9.31.195<svg>"\\${machine}' }];
    const text = generateRules(config);
    const tokens = tokenizeRule(text);
    expect(tokens.map((token) => token.text).join('')).toBe(text);
    expect(tokens.filter((token) => token.kind === 'operator').map((token) => token.text)).toEqual(['host://', 'reqHeaders://']);
    expect(tokens.filter((token) => token.kind === 'address').map((token) => token.text)).toEqual(['192.168.170.88']);
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual([JSON.stringify(config.rules[0]!.machine).replaceAll('$', '\\u0024')]);
  });

  it('默认配置的所有行逐字保留，普通文本不作 HTML 或协议解析', () => {
    for (const text of generateRules(defaultConfig()).split('\n')) {
      expect(tokenizeRule(text).map((token) => token.text).join('')).toBe(text);
    }
    const text = '<img src=x> 10.9.31.195 https://example.com';
    expect(tokenizeRule(text)).toEqual([{ text, kind: 'plain' }]);
  });
});
