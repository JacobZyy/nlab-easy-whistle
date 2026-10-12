const BEGIN = '# BEGIN nlab-easy-whistle';
const END = '# END nlab-easy-whistle';

export function replaceManagedRules(source: string, rules: string, laterRulesFirst: boolean): string {
  const lines = [...source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)].filter((line) => line[0].length);
  let insideValue = false;
  for (const line of lines) {
    const text = line[0].trim();
    if (text.startsWith('```')) insideValue = !insideValue;
    else if (insideValue && /^#\s*(?:BEGIN|END)\s+nlab-easy-whistle\b/u.test(text)) {
      throw new Error('NLab 规则标记出现在内嵌 Values 中；未写入 Whistle。请先移除这些保留标记。');
    }
  }
  const markers = lines.filter((line) => /^#\s*(?:BEGIN|END)\s+nlab-easy-whistle\b/u.test(line[0].trim()));
  let remaining = source;
  if (markers.length) {
    if (markers.length !== 2 || markers[0]![0].trim() !== BEGIN || markers[1]![0].trim() !== END) {
      throw new Error('NLab 规则标记重复或不完整，请先修复；未写入 Whistle。');
    }
    const start = markers[0]!.index!;
    const end = markers[1]!.index! + markers[1]![0].length;
    remaining = source.slice(0, start) + source.slice(end);
  }
  if (!rules) return remaining;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const block = [BEGIN, rules.replace(/\r\n|\r|\n/gu, newline), END].join(newline);
  if (laterRulesFirst) return remaining + (remaining && !/[\r\n]$/u.test(remaining) ? newline : '') + block + newline;
  return block + newline + remaining;
}
