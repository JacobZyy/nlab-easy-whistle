export interface RuleToken {
  text: string;
  kind: 'plain' | 'comment' | 'operator' | 'address' | 'key' | 'string';
}

export function tokenizeRule(text: string): RuleToken[] {
  if (!text) return [];
  if (/^\s*#/u.test(text)) return [{ text, kind: 'comment' }];

  const tokens: RuleToken[] = [];
  const host = text.match(/^(host:\/\/)(\d{1,3}(?:\.\d{1,3}){3})(?=\s|$)/u);
  let cursor = 0;
  if (host) {
    tokens.push({ text: host[1]!, kind: 'operator' }, { text: host[2]!, kind: 'address' });
    cursor = host[0].length;
  }

  const header = /(?<=\s)reqHeaders:\/\//u.exec(text.slice(cursor));
  if (!header) {
    if (cursor < text.length) tokens.push({ text: text.slice(cursor), kind: 'plain' });
    return tokens;
  }
  const headerStart = cursor + header.index;
  if (headerStart > cursor) tokens.push({ text: text.slice(cursor, headerStart), kind: 'plain' });
  tokens.push({ text: header[0], kind: 'operator' });
  cursor = headerStart + header[0].length;

  const json = text.slice(cursor);
  for (const match of json.matchAll(/"(?:\\.|[^"\\])*"/gu)) {
    const start = headerStart + header[0].length + match.index;
    if (start > cursor) tokens.push({ text: text.slice(cursor, start), kind: 'plain' });
    cursor = start + match[0].length;
    tokens.push({ text: match[0], kind: /^\s*:/u.test(text.slice(cursor)) ? 'key' : 'string' });
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), kind: 'plain' });
  return tokens;
}
