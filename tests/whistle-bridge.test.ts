import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhistleMiddleware } from '../server/whistle-bridge';
import { WHISTLE_RULE_NAME } from '../src/whistle-client';

let server: Server;
let directory: string;
let pidPath: string;
let port: number;
const upstream = vi.fn<typeof fetch>();
const target = 'http://127.0.0.1:18899';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nlab-whistle-bridge-'));
  pidPath = join(directory, '.whistle_client.pid');
  upstream.mockReset().mockImplementation(async () => Response.json({ ec: 0 }));
  vi.stubGlobal('fetch', upstream);
  const middleware = createWhistleMiddleware(pidPath);
  server = createServer((request, response) => {
    middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

function call(path: string, options: { method?: string; headers?: import('node:http').OutgoingHttpHeaders; body?: string; noOrigin?: boolean } = {}) {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, method: options.method ?? 'GET',
      headers: {
        ...(!options.noOrigin ? { origin: `http://127.0.0.1:${port}` } : {}),
        ...(options.body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...options.headers,
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode!, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.end(options.body);
  });
}

function api(path: string, address = target, query: Record<string, string> = {}) {
  return `/api/whistle/${path}?${new URLSearchParams({ target: address, ...query })}`;
}

function form(extra: Record<string, string> = {}) {
  return new URLSearchParams({ name: WHISTLE_RULE_NAME, value: 'example.com host://192.168.170.88', selected: '1', ...extra }).toString();
}

describe('Whistle 受限同源 HTTP bridge', () => {
  it('三个固定接口正常转发，表单保存并启用；不转发浏览器身份信息或上游响应头', async () => {
    upstream.mockImplementation(async () => Response.json({ ec: 0 }, { headers: { 'set-cookie': 'private', 'x-whistle-special-auth': 'private' } }));
    expect((await call(api('rules/status'), { noOrigin: true })).status).toBe(200);
    expect((await call(api('rules/value', target, { name: WHISTLE_RULE_NAME }))).status).toBe(200);
    const result = await call(api('rules/add'), { method: 'POST', body: form(), headers: { cookie: 'browser-cookie', authorization: 'browser-auth' } });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({ ec: 0 });
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['x-whistle-special-auth']).toBeUndefined();
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([
      `${target}/cgi-bin/rules/status`,
      `${target}/cgi-bin/rules/value?${new URLSearchParams({ name: WHISTLE_RULE_NAME })}`,
      `${target}/cgi-bin/rules/add`,
    ]);
    const saved = upstream.mock.calls[2]![1]!;
    expect(saved.method).toBe('POST');
    expect(saved.body).toBeInstanceOf(URLSearchParams);
    expect(String(saved.body)).toBe(form());
    expect([...new Headers(saved.headers)]).toEqual([]);
    expect(saved.redirect).toBe('error');
    expect(saved.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['rules/remove', 'POST', {}, form(), 404],
    ['rules/status', 'POST', {}, form(), 405],
    ['rules/add', 'GET', {}, undefined, 405],
    ['rules/value', 'GET', { name: 'Default' }, undefined, 400],
    ['rules/status', 'GET', { extra: '1' }, undefined, 400],
    ['rules/add', 'POST', {}, form({ name: 'Default' }), 400],
    ['rules/add', 'POST', {}, form({ selected: '0' }), 400],
    ['rules/add', 'POST', {}, form({ recycleFilename: 'other-file' }), 400],
    ['rules/add', 'POST', {}, `${form()}&name=${encodeURIComponent(WHISTLE_RULE_NAME)}`, 400],
  ] as const)('拒绝不允许的路径、方法或参数：%s %s %j', async (path, method, query, body, status) => {
    expect((await call(api(path, target, query), { method, ...(body === undefined ? {} : { body }) })).status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('重复 query 参数和看似 API 的不同前缀也被拒绝', async () => {
    expect((await call(`${api('rules/status')}&target=${encodeURIComponent(target)}`)).status).toBe(400);
    expect((await call(`/api/whistleXrules/status?${new URLSearchParams({ target })}`)).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    { headers: { origin: 'https://evil.example' } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { host: 'evil.example' } },
    { method: 'POST', body: form(), noOrigin: true },
  ])('拒绝跨域和非本地 Host：%j', async options => {
    expect((await call(api(options.method === 'POST' ? 'rules/add' : 'rules/status'), options)).status).toBeGreaterThanOrEqual(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    'http://192.168.170.88:8899', 'http://example.com:8899', 'http://127.0.0.1.evil.example:8899',
    'https://127.0.0.1:8899', 'http://user:password@127.0.0.1:8899', 'http://127.0.0.1:8899?x=1', 'http://127.0.0.1:8899#fragment',
  ])('拒绝非本地 HTTP 目标或隐藏参数：%s', async address => {
    expect((await call(api('rules/status', address))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:18899', 'http://[::1]:18899', `${target}/whistle`])('接受本地地址及基础路径：%s', async address => {
    expect((await call(api('rules/status', address))).status).toBe(200);
    expect(String(upstream.mock.calls[0]![0])).toBe(`${address}/cgi-bin/rules/status`);
  });

  it('仅目标 host/port 精确匹配活跃 PID 时附加 Whistle.app 认证', async () => {
    await writeFile(pidPath, `${process.pid},127.0.0.1,18899,test-local-secret`);
    await call(api('rules/status'));
    expect(new Headers(upstream.mock.calls[0]![1]!.headers).get('x-whistle-special-auth')).toBe('test-local-secret');
    await call(api('rules/status', 'http://127.0.0.1:18898'));
    await call(api('rules/status', 'http://localhost:18899'));
    expect(upstream.mock.calls.slice(1).every(([, init]) => !new Headers(init!.headers).has('x-whistle-special-auth'))).toBe(true);
  });

  it('PID 已结束时不传认证，缺失凭据文件也允许普通 CLI 实例', async () => {
    expect((await call(api('rules/status'))).status).toBe(200);
    await writeFile(pidPath, `${process.pid},127.0.0.1,18899,test-local-secret`);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ESRCH' }); });
    expect((await call(api('rules/status'))).status).toBe(200);
    expect(upstream.mock.calls.every(([, init]) => !new Headers(init!.headers).has('x-whistle-special-auth'))).toBe(true);
  });

  it.each(['broken', '1,127.0.0.1,18899,', '1,127.0.0.1,70000,secret', '1,evil.example,18899,secret', '1,127.0.0.1/path,18899,secret', '1,127.0.0.1,18899,secret\r\n'])('损坏凭据文件失败关闭：%s', async content => {
    await writeFile(pidPath, content);
    expect((await call(api('rules/status'))).status).toBe(502);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('拒绝错误表单类型及超过 1 MiB 的请求', async () => {
    expect((await call(api('rules/add'), { method: 'POST', body: form(), headers: { 'content-type': 'application/json' } })).status).toBe(415);
    const body = form({ value: 'x'.repeat(1024 * 1024) });
    expect((await call(api('rules/add'), { method: 'POST', body, headers: { 'content-length': String(Buffer.byteLength(body)) } })).status).toBe(413);
    expect((await call(api('rules/add'), { method: 'POST', body })).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('上游 HTTP 错误保留状态，非 JSON 和网络错误可读；不跟随重定向', async () => {
    upstream.mockResolvedValueOnce(new Response('login', { status: 401, headers: { 'set-cookie': 'private' } }));
    const unauthorized = await call(api('rules/status'));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.text).toContain('HTTP 401');
    expect(unauthorized.headers['set-cookie']).toBeUndefined();
    upstream.mockResolvedValueOnce(new Response('<html>wrong</html>'));
    const invalid = await call(api('rules/status'));
    expect(invalid.status).toBe(502);
    expect(invalid.text).toContain('有效 JSON');
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'));
    const failed = await call(api('rules/status'));
    expect(failed.status).toBe(502);
    expect(failed.text).toContain('连接 Whistle 失败');
    expect(upstream.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });
});
