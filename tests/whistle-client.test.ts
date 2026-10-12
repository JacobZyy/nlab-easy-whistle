import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWhistleRules, WHISTLE_RULE_NAME } from '../src/whistle-client';

const BASE_URL = 'http://127.0.0.1:18899';
const BEGIN = '# BEGIN nlab-easy-whistle';
const END = '# END nlab-easy-whistle';
const LEGACY_DEFAULT = `manual-before\r\n${BEGIN}\r\nlegacy-rule\r\n${END}\r\nmanual-after\r\n`;
const managed = (rule: string) => `${BEGIN}\n${rule}\n${END}\n`;

interface RuleFile { text: string; selected: boolean }
interface ServerState {
  group: RuleFile | null;
  default: RuleFile;
  disabled: boolean;
  laterRulesFirst: boolean;
}
type RequestEvent =
  | { kind: 'read'; count: number }
  | { kind: 'status'; count: number }
  | { kind: 'save'; value: string; form: URLSearchParams };
type SaveEvent = Extract<RequestEvent, { kind: 'save' }>;
const forbiddenRequests: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  expect(forbiddenRequests.splice(0)).toEqual([]);
});

function fakeWhistle(options: {
  group?: RuleFile | null;
  defaultEnabled?: boolean;
  disabled?: boolean;
  onRequest?: (event: RequestEvent, state: ServerState) => Response | void;
} = {}) {
  const state: ServerState = {
    group: options.group ? { ...options.group } : null,
    default: { text: LEGACY_DEFAULT, selected: options.defaultEnabled ?? false },
    disabled: options.disabled ?? false,
    laterRulesFirst: false,
  };
  const events: RequestEvent[] = [];
  let reads = 0;
  let statuses = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toMatch(/^\/api\/whistle\/rules\//u);
    expect(init.credentials).toBe('include');
    expect(init.headers).toBeUndefined();
    expect(init.cache).toBe('no-store');
    const parsed = new URL(url, 'http://127.0.0.1:4317');
    expect(parsed.searchParams.get('target')).toBe(BASE_URL);
    let event: RequestEvent;
    if (parsed.pathname === '/api/whistle/rules/status') {
      expect(init.method).toBe('GET');
      expect([...parsed.searchParams.keys()].sort()).toEqual(['target']);
      event = { kind: 'status', count: ++statuses };
    } else if (parsed.pathname === '/api/whistle/rules/value') {
      const name = parsed.searchParams.get('name');
      if (name !== WHISTLE_RULE_NAME) forbiddenRequests.push(url);
      expect(name).toBe(WHISTLE_RULE_NAME);
      expect(init.method).toBe('GET');
      expect([...parsed.searchParams.keys()].sort()).toEqual(['name', 'target']);
      event = { kind: 'read', count: ++reads };
    } else {
      if (parsed.pathname !== '/api/whistle/rules/add') forbiddenRequests.push(url);
      expect(parsed.pathname).toBe('/api/whistle/rules/add');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(URLSearchParams);
      const form = init.body as URLSearchParams;
      if (form.get('name') !== WHISTLE_RULE_NAME) forbiddenRequests.push(url);
      expect(form.get('name')).toBe(WHISTLE_RULE_NAME);
      expect(form.get('selected')).toBe('1');
      expect([...form.keys()].sort()).toEqual(['name', 'selected', 'value']);
      event = { kind: 'save', value: form.get('value')!, form };
    }
    events.push(event);
    const customResponse = options.onRequest?.(event, state);
    if (customResponse) return customResponse;
    if (event.kind === 'status') return Response.json({ disabled: state.disabled, laterRulesFirst: state.laterRulesFirst });
    if (event.kind === 'read') return Response.json({ value: state.group ? { value: state.group.text, selected: state.group.selected } : null });
    state.group = { text: event.value, selected: true };
    return Response.json({ ec: 0 });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    state,
    events,
    fetch,
    posts: () => events.filter((event): event is SaveEvent => event.kind === 'save'),
  };
}

describe('Whistle 独立规则文件 HTTP 契约', () => {
  it.each([true, false])('同源桥接新建并启用，旧 Default 文本和启用=%s 均不变', async (defaultEnabled) => {
    const server = fakeWhistle({ defaultEnabled });
    const rule = 'host://192.168.170.88 */merchant reqHeaders://{"Global-Route-Tag":"jacobzy"}';
    expect(WHISTLE_RULE_NAME).toBe('NLab Easy Whistle');
    expect(await applyWhistleRules(` ${BASE_URL}/ `, rule)).toEqual({ disabled: false, groupEnabled: true });
    expect(server.posts()).toHaveLength(1);
    expect(server.posts()[0]!.form.toString()).toContain('name=NLab+Easy+Whistle');
    expect(server.state.group).toEqual({ text: managed(rule), selected: true });
    expect(server.state.default).toEqual({ text: LEGACY_DEFAULT, selected: defaultEnabled });
    expect(server.events.filter(event => event.kind === 'read')).toHaveLength(3);
  });

  it.each([false, true])('内容相同时，启用=%s 决定是否仍须保存启用', async (selected) => {
    const server = fakeWhistle({ group: { text: managed('rule'), selected } });
    expect(await applyWhistleRules(BASE_URL, 'rule')).toEqual({ disabled: false, groupEnabled: true });
    expect(server.posts()).toHaveLength(selected ? 0 : 1);
    expect(server.state.group).toEqual({ text: managed('rule'), selected: true });
  });

  it('管理区外文字逐字保留；启用文件不更改全局禁用状态', async () => {
    const server = fakeWhistle({
      group: { text: `before\r\n${BEGIN}\r\nold-rule\r\n${END}\r\nafter\r\n`, selected: false },
      disabled: true,
    });
    expect(await applyWhistleRules(BASE_URL, 'new-rule')).toEqual({ disabled: true, groupEnabled: true });
    expect(server.state.group).toEqual({ text: `${BEGIN}\r\nnew-rule\r\n${END}\r\nbefore\r\nafter\r\n`, selected: true });
    expect(server.state.disabled).toBe(true);
    expect(server.state.default).toEqual({ text: LEGACY_DEFAULT, selected: false });
  });

  it('清空配置仅清理该文件的管理区，保留手写文本并启用', async () => {
    const server = fakeWhistle({ group: { text: `before\n${BEGIN}\nold-rule\n${END}\nafter`, selected: false } });
    await applyWhistleRules(BASE_URL, '');
    expect(server.state.group).toEqual({ text: 'before\nafter', selected: true });
    expect(server.posts()).toHaveLength(1);
  });

  it.each(['text', 'removed', 'created', 'order'] as const)('写前发现 %s 并发变更，拒绝覆盖', async (change) => {
    const server = fakeWhistle({
      group: change === 'created' ? null : { text: 'manual\n', selected: true },
      onRequest(event, state) {
        if (event.kind === 'read' && event.count === 2) {
          if (change === 'text') state.group!.text += '# concurrent edit';
          if (change === 'removed') state.group = null;
          if (change === 'created') state.group = { text: '', selected: false };
        }
        if (event.kind === 'status' && event.count === 2 && change === 'order') state.laterRulesFirst = true;
      },
    });
    await expect(applyWhistleRules(BASE_URL, 'new-rule')).rejects.toThrow('其他窗口修改');
    expect(server.posts()).toHaveLength(0);
  });

  it('返回回读的最新全局状态，不写全局开关', async () => {
    const server = fakeWhistle({
      onRequest(event, state) {
        if (event.kind === 'status' && event.count === 3) state.disabled = true;
      },
    });
    expect(await applyWhistleRules(BASE_URL, 'rule')).toEqual({ disabled: true, groupEnabled: true });
    expect(server.posts()).toHaveLength(1);
  });

  it.each(['text', 'disabled', 'missing'] as const)('回读 %s 不符合保存结果，报告失败且不重试', async (failure) => {
    const server = fakeWhistle({
      onRequest(event, state) {
        if (event.kind === 'read' && event.count === 3) {
          if (failure === 'text') state.group!.text = 'concurrent edit';
          if (failure === 'disabled') state.group!.selected = false;
          if (failure === 'missing') state.group = null;
        }
      },
    });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow(failure === 'disabled' ? '未启用' : '回读内容');
    expect(server.posts()).toHaveLength(1);
  });

  it.each(['rejected', 'network', 'json'] as const)('保存 %s 失败，不回滚、不重试', async (failure) => {
    const server = fakeWhistle({
      onRequest(event) {
        if (event.kind !== 'save') return;
        if (failure === 'rejected') return Response.json({ ec: 1 });
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return new Response('<html>login</html>');
      },
    });
    const message = { rejected: '未确认保存成功', network: '结果未确认', json: '不是有效 JSON' }[failure];
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow(message);
    expect(server.posts()).toHaveLength(1);
    expect(server.state.group).toBeNull();
  });

  it.each(['network', 'json', 'value', 'status'] as const)('读取 %s 失败时不写入', async (failure) => {
    const server = fakeWhistle({
      onRequest(event) {
        if (event.kind === 'read') {
          if (failure === 'network') throw new TypeError('Failed to fetch');
          if (failure === 'json') return new Response('<html>login</html>');
          if (failure === 'value') return Response.json({ value: { value: '', selected: 'true' } });
        }
        if (event.kind === 'status' && failure === 'status') return Response.json({ disabled: false });
      },
    });
    const message = { network: '无法读取 Whistle', json: '不是有效 JSON', value: '格式不正确', status: '格式不正确' }[failure];
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow(message);
    expect(server.posts()).toHaveLength(0);
  });

  it.each([
    { status: 502, body: { error: '本地 Whistle HTTP 服务不可用。' }, expected: 'HTTP 502：本地 Whistle HTTP 服务不可用。' },
    { status: 401, body: null, expected: 'HTTP 401：Whistle 鉴权失败' },
  ])('桥接返回 $status 时显示安全错误', async ({ status, body, expected }) => {
    const server = fakeWhistle({
      onRequest(event) {
        if (event.kind === 'read') return body ? Response.json(body, { status }) : new Response('', { status });
      },
    });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow(expected);
    expect(server.posts()).toHaveLength(0);
  });

  it('管理区标记损坏时拒绝写入', async () => {
    const server = fakeWhistle({ group: { text: `${BEGIN}\nold-rule\n`, selected: true } });
    await expect(applyWhistleRules(BASE_URL, 'rule')).rejects.toThrow('标记');
    expect(server.posts()).toHaveLength(0);
  });
});
