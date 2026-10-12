import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { exportYaml } from '../src/config-export';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));

const text = 'version: 1\nrules: []\n';
const link = { href: '', download: '', click: vi.fn() };
const createElement = vi.fn(() => link);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(invoke).mockReset();
  link.href = '';
  link.download = '';
  link.click.mockReset();
  createElement.mockClear();
  vi.stubGlobal('document', { createElement });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:yaml');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('YAML 导出', () => {
  it('网页保留 Blob 下载、文件名和原始内容，延迟回收 URL', async () => {
    expect(await exportYaml(text)).toBe(true);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/yaml;charset=utf-8');
    expect(await blob.text()).toBe(text);
    expect(createElement).toHaveBeenCalledWith('a');
    expect(link.href).toBe('blob:yaml');
    expect(link.download).toBe('nlab-easy-whistle.yaml');
    expect(link.click).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yaml');
  });

  it.each([true, false])('原生保存结果=%s，不触发 Blob 下载', async (saved) => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(saved);
    expect(await exportYaml(text)).toBe(saved);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('export_yaml', { text });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('原生保存失败向调用方报错，不回退网页下载', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue('无法保存 YAML：磁盘不可写。');
    await expect(exportYaml(text)).rejects.toBe('无法保存 YAML：磁盘不可写。');
    expect(invoke).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('网页下载失败向调用方报错，仍回收 URL', async () => {
    link.click.mockImplementation(() => { throw new Error('download failed'); });
    await expect(exportYaml(text)).rejects.toThrow('download failed');
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:yaml');
    expect(invoke).not.toHaveBeenCalled();
  });
});
