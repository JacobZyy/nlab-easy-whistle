import { ref, watch } from 'vue';
import { defaultConfig, validateConfig, type RuleConfig } from '../rule-config';

const STORAGE_KEY = 'nlab-easy-whistle-config-v1';
const PROTOTYPE_KEY = 'nlab-easy-whistle-desktop-prototype-v2';

export function useRuleConfig(warn: (message: string) => void) {
  let initial = defaultConfig();
  let preserveStoredValue = false;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const source = stored ?? localStorage.getItem(PROTOTYPE_KEY);
    if (source !== null) initial = validateConfig(JSON.parse(source));
  } catch {
    preserveStoredValue = true;
    warn('本地配置无法读取，原始数据已保留。当前修改不会自动保存；导入配置并确认后可替换。');
  }

  const config = ref<RuleConfig>(initial);

  watch(config, (value) => {
    if (preserveStoredValue) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      warn('浏览器无法保存配置，当前修改仅保留在本页。请导出 YAML 备份。');
    }
  }, { deep: true });

  function replaceConfig(value: RuleConfig) {
    const validated = validateConfig(value);
    preserveStoredValue = false;
    config.value = validated;
  }

  return { config, replaceConfig };
}
