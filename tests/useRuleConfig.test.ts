import { effectScope, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRuleConfig } from '../src/composables/useRuleConfig';
import { defaultConfig } from '../src/rule-config';

const KEY = 'nlab-easy-whistle-config-v1';
const PROTOTYPE_KEY = 'nlab-easy-whistle-desktop-prototype-v2';
afterEach(() => vi.unstubAllGlobals());

describe('本地记忆', () => {
  it('本地环境自定义端口保存后可重新读取', async () => {
    const saved = defaultConfig();
    saved.rules = [{ name: '本地管理端', enabled: true, patterns: ['*/u/nlab-manage', '*/nlab-manage'], environment: 'local', machine: '', port: 8000 }];
    const storage = new Map([[KEY, JSON.stringify(saved)]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const warn = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useRuleConfig(warn))!;
    expect(state.config.value).toEqual(saved);
    state.config.value.rules[0]!.port = 5173;
    await nextTick();
    scope.stop();
    const reopenedScope = effectScope();
    const reopened = reopenedScope.run(() => useRuleConfig(warn))!;
    expect(reopened.config.value.rules[0]).toEqual({ ...saved.rules[0], port: 5173 });
    expect(warn).not.toHaveBeenCalled();
    reopenedScope.stop();
  });

  it.each([KEY, PROTOTYPE_KEY])('旧存储缺少名称时读取为空白，修改后记忆名称：%s', async (key) => {
    const saved = defaultConfig();
    const legacy = { ...saved, rules: saved.rules.map(({ name, ...rule }) => rule) };
    const storage = new Map([[key, JSON.stringify(legacy)]]);
    vi.stubGlobal('localStorage', { getItem: (item: string) => storage.get(item) ?? null, setItem: (item: string, value: string) => storage.set(item, value) });
    const warn = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useRuleConfig(warn))!;
    expect(state.config.value.rules[0]!.name).toBe('');
    expect(warn).not.toHaveBeenCalled();
    state.config.value.rules[0]!.name = '商户回收';
    await nextTick();
    const stored = JSON.parse(storage.get(KEY)!);
    expect(stored.rules[0].name).toBe('商户回收');
    expect(stored.rules[0].patterns).toEqual(saved.rules[0]!.patterns);
    scope.stop();
  });

  it('正式坏数据优先保留，显式导入才能替换', async () => {
    const storage = new Map([[KEY, '{bad json'], [PROTOTYPE_KEY, JSON.stringify(defaultConfig())]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const warn = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useRuleConfig(warn))!;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('原始数据已保留'));
    state.config.value.rules[0]!.enabled = false;
    await nextTick();
    expect(storage.get(KEY)).toBe('{bad json');
    state.replaceConfig(defaultConfig());
    await nextTick();
    expect(JSON.parse(storage.get(KEY)!)).toEqual(defaultConfig());
    scope.stop();
  });

  it('首次读取原型配置，后续修改写入正式配置', async () => {
    const saved = defaultConfig();
    saved.rules[0]!.machine = 'lutong';
    const storage = new Map([[PROTOTYPE_KEY, JSON.stringify(saved)]]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const scope = effectScope();
    const state = scope.run(() => useRuleConfig(vi.fn()))!;
    expect(state.config.value.rules[0]!.machine).toBe('lutong');
    state.config.value.rules[0]!.enabled = false;
    await nextTick();
    expect(JSON.parse(storage.get(KEY)!).rules[0].enabled).toBe(false);
    scope.stop();
  });

  it('存储失败明确提示，当前配置仍可导出', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    const warn = vi.fn();
    const scope = effectScope();
    const state = scope.run(() => useRuleConfig(warn))!;
    state.config.value.rules[0]!.enabled = false;
    await nextTick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('导出 YAML'));
    expect(state.config.value.rules[0]!.enabled).toBe(false);
    scope.stop();
  });
});
