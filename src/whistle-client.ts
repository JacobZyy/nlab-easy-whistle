import { normalizeUrl } from './rule-config';
import { replaceManagedRules } from './managed-rules';
import { isTauri, invoke } from '@tauri-apps/api/core';

interface RuleStatus { disabled: boolean; laterRulesFirst: boolean }
interface RuleFile { text: string; selected: boolean }
export const WHISTLE_RULE_NAME = 'NLab Easy Whistle';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function applyWhistleRules(url: string, rules: string): Promise<{ disabled: boolean; groupEnabled: boolean }> {
  const baseUrl = normalizeUrl(url);
  async function request(path: string, body?: URLSearchParams): Promise<unknown> {
    let response: Response;
    try {
      if (isTauri()) {
        const result = await invoke<{ status: number; body: unknown }>('whistle_request', {
          target: baseUrl, path, ...(body ? { body: body.toString() } : {}),
        });
        response = new Response(JSON.stringify(result.body), { status: result.status });
      } else {
        const query = new URLSearchParams({ target: baseUrl });
        response = await fetch(`/api/whistle/${path}${path.includes('?') ? '&' : '?'}${query}`, {
          method: body ? 'POST' : 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
          ...(body ? { body } : {}),
        });
      }
    } catch (cause) {
      const detail = cause instanceof Error && cause.name === 'TimeoutError' ? '请求超时' : '网络访问失败';
      throw new Error(body ? `Whistle 保存请求${detail}，结果未确认。请检查 ${WHISTLE_RULE_NAME} 后再应用。` : `无法读取 Whistle：${detail}。请检查地址及本地 HTTP 服务。`);
    }
    if (!response.ok) {
      let detail = response.status === 401 ? 'Whistle 鉴权失败，请检查本机实例。' : '';
      try {
        const result: unknown = await response.json();
        if (isRecord(result) && typeof result.error === 'string') detail = result.error;
      } catch {}
      throw new Error(`Whistle 返回 HTTP ${response.status}${detail ? `：${detail}` : '。'}`);
    }
    try { return await response.json(); } catch { throw new Error('Whistle 返回的内容不是有效 JSON；请检查地址和本机实例。'); }
  }

  async function readRule(): Promise<RuleFile | null> {
    const result = await request(`rules/value?${new URLSearchParams({ name: WHISTLE_RULE_NAME })}`);
    if (isRecord(result) && result.value === null) return null;
    if (!isRecord(result) || !isRecord(result.value) || typeof result.value.selected !== 'boolean'
      || typeof result.value.value !== 'string') {
      throw new Error(`Whistle ${WHISTLE_RULE_NAME} 接口返回格式不正确；未确认规则内容。`);
    }
    return { text: result.value.value, selected: result.value.selected };
  }

  async function readStatus(): Promise<RuleStatus> {
    const result = await request('rules/status');
    if (!isRecord(result) || typeof result.laterRulesFirst !== 'boolean'
      || (result.disabled !== undefined && typeof result.disabled !== 'boolean')) {
      throw new Error('Whistle 规则状态接口返回格式不正确。');
    }
    return { disabled: result.disabled ?? false, laterRulesFirst: result.laterRulesFirst };
  }

  const [initial, status] = await Promise.all([readRule(), readStatus()]);
  const updated = replaceManagedRules(initial?.text ?? '', rules, status.laterRulesFirst);
  // Whistle has no compare-and-swap API; catch edits observed immediately before the write.
  const [latest, latestStatus] = await Promise.all([readRule(), readStatus()]);
  if (latest?.text !== initial?.text || latestStatus.laterRulesFirst !== status.laterRulesFirst) {
    throw new Error('Whistle 规则刚被其他窗口修改；未写入。请重新应用。');
  }
  if (updated !== latest?.text || !latest?.selected) {
    const result = await request('rules/add', new URLSearchParams({ name: WHISTLE_RULE_NAME, value: updated, selected: '1' }));
    if (!isRecord(result) || result.ec !== 0) throw new Error(`Whistle 未确认保存成功。请检查 ${WHISTLE_RULE_NAME} 后再应用。`);
  }
  const [saved, savedStatus] = await Promise.all([readRule(), readStatus()]);
  if (saved?.text !== updated) throw new Error(`Whistle 回读内容与保存内容不同，结果未确认。请检查 ${WHISTLE_RULE_NAME}。`);
  if (!saved.selected) throw new Error(`${WHISTLE_RULE_NAME} 规则文件未启用；请检查 Whistle 的规则模式。`);
  return { disabled: savedStatus.disabled, groupEnabled: saved.selected };
}
