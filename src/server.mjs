import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import {
  ALLOW_ORIGIN_POST,
  ASSET_CACHE_ROOT,
  HOST,
  ORIGIN,
  PORT,
  PROJECT_ROOT,
  VENDOR_ROOT,
} from './config.mjs';
import { injectHtml, isHtmlResponse } from './lib/html.mjs';
import { loadStatus, loadTranslationsFor } from './lib/translations.mjs';
import { getPageHtml } from './lib/page-cache.mjs';

const text = (value) => Buffer.from(value, 'utf8');

const send = (res, status, body, headers = {}) => {
  const payload = Buffer.isBuffer(body) ? body : text(body);
  const cleanHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null),
  );
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': payload.byteLength,
    ...cleanHeaders,
  });
  res.end(payload);
};

const sendCompressed = (req, res, status, body, headers = {}) => {
  const payload = Buffer.isBuffer(body) ? body : text(body);
  const accepted = req.headers['accept-encoding'] || '';
  if (payload.byteLength < 1024 || (!accepted.includes('br') && !accepted.includes('gzip'))) {
    send(res, status, payload, headers);
    return;
  }
  const useBrotli = accepted.includes('br');
  const compressed = useBrotli
    ? brotliCompressSync(payload, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    : gzipSync(payload, { level: 6 });
  send(res, status, compressed, {
    ...headers,
    'content-encoding': useBrotli ? 'br' : 'gzip',
    vary: 'accept-encoding',
  });
};

const stream = (req, res, upstream, headers = {}) => {
  const cleanHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined && value !== null),
  );
  res.writeHead(upstream.status, cleanHeaders);
  if (req.method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
};

const assetCachePath = (pathname) => {
  if (!pathname.startsWith('/_next/static/') && !pathname.startsWith('/fonts/')) return null;
  const clean = pathname.split('/').filter(Boolean).map((part) => encodeURIComponent(part));
  return path.join(ASSET_CACHE_ROOT, ...clean);
};

const serveCachedAsset = async (req, res, upstreamHeaders) => {
  const incoming = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const filePath = assetCachePath(incoming.pathname);
  if (!filePath || !['GET', 'HEAD'].includes(req.method || 'GET')) return false;
  try {
    const [payload, metadata] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(`${filePath}.json`, 'utf8').then(JSON.parse),
    ]);
    send(res, 200, req.method === 'HEAD' ? '' : payload, {
      'content-type': metadata.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      vary: metadata.vary,
      'x-aihero-zh-asset-cache': 'hit',
    });
    return true;
  } catch {}

  const target = originUrlFor(req.url || '/');
  const upstream = await fetch(target, { headers: upstreamHeaders, redirect: 'manual' });
  const payload = Buffer.from(await upstream.arrayBuffer());
  const metadata = {
    contentType: upstream.headers.get('content-type') || 'application/octet-stream',
    vary: upstream.headers.get('vary') || undefined,
  };
  if (upstream.ok) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await Promise.all([
      fs.writeFile(filePath, payload),
      fs.writeFile(`${filePath}.json`, JSON.stringify(metadata)),
    ]);
  }
  send(res, upstream.status, req.method === 'HEAD' ? '' : payload, {
    'content-type': metadata.contentType,
    'cache-control': upstream.ok ? 'public, max-age=31536000, immutable' : 'no-store',
    vary: metadata.vary,
    'x-aihero-zh-asset-cache': upstream.ok ? 'miss' : 'bypass',
  });
  return true;
};

const serveFile = async (res, relativePath, contentType) => {
  try {
    const filePath = path.join(PROJECT_ROOT, relativePath);
    const payload = await fs.readFile(filePath);
    send(res, 200, payload, { 'content-type': contentType });
  } catch {
    send(res, 404, 'Not found\n', { 'content-type': 'text/plain; charset=utf-8' });
  }
};

const originUrlFor = (requestUrl) => {
  const incoming = new URL(requestUrl, `http://${HOST}:${PORT}`);
  return new URL(`${incoming.pathname}${incoming.search}`, ORIGIN);
};

const requestHeadersFor = (req, target) => {
  const headers = new Headers();
  for (const name of [
    'accept',
    'accept-language',
    'user-agent',
    'range',
    'content-type',
    'next-action',
    'next-router-state-tree',
    'next-router-prefetch',
    'next-url',
    'rsc',
    'trpc-accept',
    'x-trpc-source',
  ]) {
    const value = req.headers[name];
    if (value) headers.set(name, value);
  }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    headers.set('origin', ORIGIN);
    headers.set('referer', target.toString());
  }
  headers.set('x-aihero-zh-proxy', '1');
  return headers;
};

const proxyOrigin = async (req, res) => {
  const incoming = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (!ALLOW_ORIGIN_POST && !['GET', 'HEAD'].includes(req.method || 'GET')) {
    send(res, 405, 'This community mirror only proxies public GET requests.\n', {
      allow: 'GET, HEAD',
      'content-type': 'text/plain; charset=utf-8',
    });
    return;
  }

  const target = originUrlFor(req.url || '/');
  const upstreamHeaders = requestHeadersFor(req, target);
  if (await serveCachedAsset(req, res, upstreamHeaders)) return;
  const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (wantsHtml) {
    const cached = await getPageHtml(incoming.pathname);
    const dictionary = await loadTranslationsFor(incoming.pathname);
    const html = injectHtml(cached.html, {
      pathname: incoming.pathname,
      requestUrl: target.toString(),
      dictionary,
      serverTranslate: true,
    });
    sendCompressed(req, res, 200, html, {
      'content-type': 'text/html; charset=utf-8',
      'x-aihero-zh-cache': cached.cache,
      etag: cached.metadata?.etag,
      'last-modified': cached.metadata?.lastModified,
    });
    return;
  }
  const body = req.method && !['GET', 'HEAD'].includes(req.method)
    ? await readBody(req)
    : undefined;
  const upstream = await fetch(target, {
    method: req.method,
    headers: upstreamHeaders,
    body,
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
    const location = upstream.headers.get('location');
    const localLocation = location?.replace(ORIGIN, '') || location;
    send(res, upstream.status, '', { location: localLocation });
    return;
  }

  const upstreamType = upstream.headers.get('content-type') || 'application/octet-stream';
  const responseHeaders = {
    'content-type': upstreamType,
    'cache-control': upstream.headers.get('cache-control') || 'no-store',
    etag: upstream.headers.get('etag') || undefined,
    'last-modified': upstream.headers.get('last-modified') || undefined,
  };

  if (isHtmlResponse(upstream)) {
    const data = Buffer.from(await upstream.arrayBuffer());
    const html = injectHtml(data.toString('utf8'), {
      pathname: incoming.pathname,
      requestUrl: target.toString(),
      dictionary: await loadTranslationsFor(incoming.pathname),
      serverTranslate: true,
    });
    sendCompressed(req, res, upstream.status, html, {
      ...responseHeaders,
      'content-type': 'text/html; charset=utf-8',
    });
    return;
  }

  stream(req, res, upstream, responseHeaders);
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > 2_000_000) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const sendJson = (res, value, status = 200) =>
  send(res, status, JSON.stringify(value, null, 2), {
    'content-type': 'application/json; charset=utf-8',
  });

const server = http.createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url || '/', `http://${HOST}:${PORT}`);

    if (incoming.pathname === '/__aihero/health') {
      sendJson(res, {
        ok: true,
        origin: ORIGIN,
        now: new Date().toISOString(),
      });
      return;
    }

    if (incoming.pathname === '/__aihero/translations') {
      sendJson(res, await loadTranslationsFor(incoming.searchParams.get('path') || '/'));
      return;
    }

    if (incoming.pathname === '/__aihero/status') {
      const status = await loadStatus();
      send(res, 200, renderStatusPage(status), { 'content-type': 'text/html; charset=utf-8' });
      return;
    }

    if (incoming.pathname === '/__aihero/translation-runtime.js') {
      await serveFile(res, 'public/translation-runtime.js', 'text/javascript; charset=utf-8');
      return;
    }

    if (incoming.pathname === '/__aihero/navigation-runtime.js') {
      await serveFile(res, 'public/navigation-runtime.js', 'text/javascript; charset=utf-8');
      return;
    }

    if (incoming.pathname === '/__aihero/zh-overrides.css') {
      await serveFile(res, 'public/zh-overrides.css', 'text/css; charset=utf-8');
      return;
    }

    if (incoming.pathname === '/__aihero/cfy-skills.user.js') {
      await serveFile(
        res,
        'vendor/cfy2015-aihero-skills-zh/aihero-skills-zh.user.js',
        'text/javascript; charset=utf-8',
      );
      return;
    }

    await proxyOrigin(req, res);
  } catch (error) {
    console.error('[aihero-zh] request failed', error);
    sendJson(res, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AI Hero 中文社区版: http://${HOST}:${PORT}`);
  console.log(`上游来源: ${ORIGIN}`);
});

const renderStatusPage = ({ manifest = {}, report = null }) => {
  const reportSummary = report
    ? `${report.changedPages || 0} 个页面有变化，${report.untranslated || 0} 条文本待翻译`
    : '还没有差异报告，请运行 npm run check-updates';
  const routes = Object.entries(manifest.routes || {})
    .map(([route, info]) => `<tr><td><code>${escapeHtml(route)}</code></td><td>${escapeHtml(info.scope || 'tracked')}</td><td>${escapeHtml(info.status || 'active')}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Hero 中文版维护状态</title>
<style>
:root{color-scheme:dark;background:#151515;color:#f1efe9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}body{max-width:980px;margin:0 auto;padding:48px 24px;line-height:1.6}h1{font-family:Georgia,serif;font-size:clamp(2rem,5vw,4rem);line-height:1.05;font-weight:500;margin:0 0 12px}p{color:#a9a69e}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{text-align:left;border-bottom:1px solid #333;padding:11px 8px}th{color:#aaa;font-size:12px;text-transform:uppercase;letter-spacing:.08em}code{color:#f5c46b}a{color:#f5c46b}.status{border-left:3px solid #f5c46b;padding-left:14px;margin:28px 0}</style></head>
<body><p>AI HERO / 中文社区版</p><h1>原站同步与翻译状态</h1><p>这个页面只服务维护者，不属于原站内容镜像。</p><div class="status">${escapeHtml(reportSummary)}</div><table><thead><tr><th>路径</th><th>范围</th><th>状态</th></tr></thead><tbody>${routes || '<tr><td colspan="3">尚未建立快照</td></tr>'}</tbody></table><p><a href="/">返回首页</a> · <a href="https://www.aihero.dev/">打开官方站点</a></p></body></html>`;
};

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
