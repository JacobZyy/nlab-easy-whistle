import { isTauri, invoke } from '@tauri-apps/api/core';

export async function exportYaml(text: string): Promise<boolean> {
  if (isTauri()) return invoke<boolean>('export_yaml', { text });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nlab-easy-whistle.yaml';
    link.click();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
