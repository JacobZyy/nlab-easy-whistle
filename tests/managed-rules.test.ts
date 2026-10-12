import { describe, expect, it } from 'vitest';
import { replaceManagedRules } from '../src/managed-rules';

const BEGIN = '# BEGIN nlab-easy-whistle';
const END = '# END nlab-easy-whistle';
const userRules = 'https://app.zhuanzhuan.com/api/example resBody://temp/example\n# local\n127.0.0.1:8510 */cycling_recycle_manage html://{vConsole.html}\n';

describe('规则文件管理区', () => {
  it.each([false, true])('保持其他规则原文，按优先模式放置，重复应用不变：%s', (laterRulesFirst) => {
    const saved = replaceManagedRules(userRules, 'managed', laterRulesFirst);
    expect(saved).toContain(userRules);
    expect(laterRulesFirst ? saved.endsWith(`${END}\n`) : saved.startsWith(BEGIN)).toBe(true);
    expect(replaceManagedRules(saved, 'managed', laterRulesFirst)).toBe(saved);
    expect(replaceManagedRules(saved, '', laterRulesFirst)).toBe(userRules);
  });

  it('替换内部管理区后完整保留前后文本及 CRLF', () => {
    const source = `first\r\n${BEGIN}\r\nold\r\n${END}\r\nlast\r\n`;
    expect(replaceManagedRules(source, '', false)).toBe('first\r\nlast\r\n');
    expect(replaceManagedRules(source, 'one\ntwo', false)).toBe(`${BEGIN}\r\none\r\ntwo\r\n${END}\r\nfirst\r\nlast\r\n`);
  });

  it.each([
    `${BEGIN}\nold`, `${END}\n`, `${END}\n${BEGIN}\n`,
    `${BEGIN}\n${END}\n${BEGIN}\n${END}\n`, `${BEGIN} extra\n${END}\n`,
  ])('标记损坏停止，原文不会被截断：%s', (source) => {
    expect(() => replaceManagedRules(source, 'new', false)).toThrow('未写入');
  });

  it('处理空规则文件及无末尾换行的文本', () => {
    expect(replaceManagedRules('', '', false)).toBe('');
    expect(replaceManagedRules('untouched', 'new', false)).toBe(`${BEGIN}\nnew\n${END}\nuntouched`);
    expect(replaceManagedRules('untouched', 'new', true)).toBe(`untouched\n${BEGIN}\nnew\n${END}\n`);
  });

  it('内嵌 Values 中的保留标记不会被删除', () => {
    const source = ['``` response', BEGIN, 'response text', END, '```'].join('\n');
    expect(() => replaceManagedRules(source, 'new', false)).toThrow('内嵌 Values');
  });
});
