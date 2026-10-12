import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { applyWhistleRules, WHISTLE_RULE_NAME } from '../src/whistle-client';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));

const BASE_URL = 'http://127.0.0.1:18899';
const managed = (rule: string) => `# BEGIN nlab-easy-whistle\n${rule}\n# END nlab-easy-whistle\n`;
const browserFetch = vi.fn();
const nativeInvoke = vi.mocked(invoke);

beforeEach(() => {
  nativeInvoke.mockReset();
  browserFetch.mockReset();
  vi.stubGlobal('fetch', browserFetch);
});

afterEach(() => {
  expect(browserFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function nativeWhistle(options: { text?: string; onRead?: (count: number) => string | undefined; saveError?: boolean } = {}) {
  let group = options.text === undefined ? null : { value: options.text, selected: false };
  let reads = 0;
  const posts: URLSearchParams[] = [];
  nativeInvoke.mockImplementation(async (command, args) => {
    expect(command).toBe('whistle_request');
    if (!args || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array) throw new Error('Expected named command arguments');
    expect(args?.target).toBe(BASE_URL);
    const path = String(args?.path);
    if (path === 'rules/status') {
      expect(args).toEqual({ target: BASE_URL, path });
      return { status: 200, body: { disabled: true, laterRulesFirst: false } };
    }
    if (path.startsWith('rules/value?')) {
      expect(args).toEqual({ target: BASE_URL, path: `rules/value?${new URLSearchParams({ name: WHISTLE_RULE_NAME })}` });
      const changed = options.onRead?.(++reads);
      if (changed !== undefined) group = { value: changed, selected: true };
      return { status: 200, body: { value: group } };
    }
    expect(path).toBe('rules/add');
    expect(Object.keys(args ?? {}).sort()).toEqual(['body', 'path', 'target']);
    expect(typeof args?.body).toBe('string');
    const form = new URLSearchParams(String(args?.body));
    expect(form.get('name')).toBe(WHISTLE_RULE_NAME);
    expect(form.get('selected')).toBe('1');
    expect([...form.keys()].sort()).toEqual(['name', 'selected', 'value']);
    posts.push(form);
    if (options.saveError) throw new Error('native connection closed');
    group = { value: form.get('value')!, selected: true };
    return { status: 200, body: { ec: 0 } };
  });
  return { posts, group: () => group };
}

describe('Tauri Whistle transport', () => {
  it('原生命令保存并回读，保留手写文本和全局禁用状态', async () => {
    const server = nativeWhistle({ text: `manual\n${managed('old')}` });
    expect(await applyWhistleRules(` ${BASE_URL}/ `, 'new')).toEqual({ disabled: true, groupEnabled: true });
    expect(server.group()).toEqual({ value: `${managed('new')}manual\n`, selected: true });
    expect(server.posts).toHaveLength(1);
    expect(nativeInvoke).toHaveBeenCalledTimes(7);
  });

  it.each([
    { status: 401, body: null, expected: 'HTTP 401：Whistle 鉴权失败' },
    { status: 502, body: { error: '本地 Whistle HTTP 服务不可用。' }, expected: 'HTTP 502：本地 Whistle HTTP 服务不可用。' },
    { status: 504, body: { error: 'Whistle 请求超时。' }, expected: 'HTTP 504：Whistle 请求超时。' },
  ])('原生命令返回 $status 时显示错误，不保存', async ({ status, body, expected }) => {
    nativeInvoke.mockResolvedValue({ status, body });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow(expected);
    expect(nativeInvoke).toHaveBeenCalledTimes(2);
  });

  it('原生读取失败，不保存', async () => {
    nativeInvoke.mockRejectedValue(new Error('native connection closed'));
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow('无法读取 Whistle');
    expect(nativeInvoke).toHaveBeenCalledTimes(2);
  });

  it('原生保存失败，结果未确认且不重试', async () => {
    const server = nativeWhistle({ saveError: true });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow('结果未确认');
    expect(server.posts).toHaveLength(1);
    expect(nativeInvoke).toHaveBeenCalledTimes(5);
  });

  it('原生写前发现并发修改，拒绝覆盖', async () => {
    const server = nativeWhistle({ text: 'manual', onRead: count => count === 2 ? 'concurrent edit' : undefined });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow('其他窗口修改');
    expect(server.posts).toHaveLength(0);
  });

  it('原生回读内容不同，报告失败且不重试', async () => {
    const server = nativeWhistle({ onRead: count => count === 3 ? 'concurrent edit' : undefined });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow('回读内容与保存内容不同');
    expect(server.posts).toHaveLength(1);
  });
});
