import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { WHISTLE_RULE_NAME } from '../src/whistle-client';

const BODY_LIMIT = 1024 * 1024;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function rejectRequest(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function localUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { rejectRequest(400, 'Whistle 地址格式不正确。'); }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash) {
    rejectRequest(400, 'Whistle 地址必须是无凭据、查询或片段的本地 HTTP 地址。');
  }
  return url;
}

async function readAuth(target: URL, pidPath: string): Promise<string | undefined> {
  let text: string;
  try { text = await readFile(pidPath, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    rejectRequest(502, '无法读取 Whistle.app 本地凭据文件；请求未发送。');
  }
  const fields = text.split(',');
  const [pid, host, port, auth] = fields;
  if (fields.length !== 4 || !/^[1-9]\d*$/u.test(pid!) || !/^[1-9]\d*$/u.test(port!)
    || Number(port) > 65535 || !Number.isSafeInteger(Number(pid)) || !auth || /[\s\u0000-\u001f\u007f]/u.test(auth)) {
    rejectRequest(502, 'Whistle.app 本地凭据文件格式异常；请求未发送。');
  }
  let client: URL;
  try { client = localUrl(`http://${host || '127.0.0.1'}:${port}`); } catch {
    rejectRequest(502, 'Whistle.app 本地凭据地址异常；请求未发送。');
  }
  if (client.pathname !== '/') rejectRequest(502, 'Whistle.app 本地凭据地址异常；请求未发送。');
  if (client.host !== target.host) return;
  try { process.kill(Number(pid), 0); } catch { return; }
  return auth;
}

function readBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length']) > BODY_LIMIT) {
    request.resume();
    rejectRequest(413, '规则文本超过 1 MiB。');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        reject(Object.assign(new Error('规则文本超过 1 MiB。'), { status: 413 }));
      } else chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

export function createWhistleMiddleware(pidPath = join(homedir(), '.whistle_client.pid')): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (!request.url?.startsWith('/api/whistle')) return next();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const host = request.headers.host;
      const origin = host ? localUrl(`http://${host}`) : undefined;
      if (!origin || origin.pathname !== '/' || request.headers['sec-fetch-site'] === 'cross-site'
        || (request.headers.origin !== undefined && request.headers.origin !== origin.origin)
        || (request.method === 'POST' && request.headers.origin !== origin.origin)) {
        rejectRequest(403, '只允许当前页面的同源请求。');
      }
      const url = new URL(request.url, origin);
      if (!url.pathname.startsWith('/api/whistle/')) rejectRequest(404, '接口不存在。');
      const path = url.pathname.slice('/api/whistle/'.length);
      const expectedMethod = path === 'rules/add' ? 'POST' : 'GET';
      if (!['rules/status', 'rules/value', 'rules/add'].includes(path)) rejectRequest(404, '接口不存在。');
      if (request.method !== expectedMethod) rejectRequest(405, '请求方法不允许。');
      const expectedKeys = path === 'rules/value' ? ['name', 'target'] : ['target'];
      if ([...url.searchParams.keys()].sort().join(',') !== expectedKeys.join(',')
        || (path === 'rules/value' && url.searchParams.get('name') !== WHISTLE_RULE_NAME)) {
        rejectRequest(400, '只允许 NLab Easy Whistle 规则文件及规定参数。');
      }
      const target = localUrl(url.searchParams.get('target')!);
      const upstream = new URL(`${target.href.replace(/\/$/u, '')}/cgi-bin/${path}`);
      if (path === 'rules/value') upstream.searchParams.set('name', WHISTLE_RULE_NAME);
      let body: URLSearchParams | undefined;
      if (request.method === 'POST') {
        if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
          rejectRequest(415, '规则保存必须使用表单请求。');
        }
        body = new URLSearchParams(await readBody(request));
        if ([...body.keys()].sort().join(',') !== 'name,selected,value' || body.get('name') !== WHISTLE_RULE_NAME || body.get('selected') !== '1') {
          rejectRequest(400, '只允许保存并启用 NLab Easy Whistle 规则文件。');
        }
      }
      const headers = new Headers();
      const auth = await readAuth(target, pidPath);
      if (auth) headers.set('x-whistle-special-auth', auth);
      const result = await fetch(upstream, {
        method: expectedMethod, headers, body, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) {
        response.statusCode = result.status;
        response.end(JSON.stringify({ error: `Whistle 返回 HTTP ${result.status}。` }));
        return;
      }
      let value: unknown;
      try { value = await result.json(); } catch { rejectRequest(502, 'Whistle 返回的内容不是有效 JSON。'); }
      response.end(JSON.stringify(value));
    } catch (error) {
      request.resume();
      const failure = error as Error & { status?: number };
      response.statusCode = failure.status ?? 502;
      response.end(JSON.stringify({ error: failure.status ? failure.message : '连接 Whistle 失败或超时；请检查本地地址。' }));
    }
  };
}

export function whistleBridge(): Plugin {
  return {
    name: 'nlab-whistle-bridge',
    configureServer(server) { server.middlewares.use(createWhistleMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(createWhistleMiddleware()); },
  };
}
