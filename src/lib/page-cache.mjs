import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_ROOT, CACHE_TTL_SECONDS, ORIGIN, PAGE_MODE } from '../config.mjs';
import { slugForPath } from './source.mjs';

const htmlDir = path.join(CACHE_ROOT, 'html');
const metadataDir = path.join(CACHE_ROOT, 'meta');
const pending = new Map();

const pathsFor = (pathname) => {
  const slug = slugForPath(pathname);
  return {
    html: path.join(htmlDir, `${slug}.html`),
    meta: path.join(metadataDir, `${slug}.json`),
  };
};

const readCached = async (pathname) => {
  const files = pathsFor(pathname);
  try {
    const [html, metadata] = await Promise.all([
      fs.readFile(files.html, 'utf8'),
      fs.readFile(files.meta, 'utf8').then(JSON.parse),
    ]);
    return { html, metadata };
  } catch {
    return null;
  }
};

export const writeCachedPage = async (pathname, html, metadata = {}) => {
  const files = pathsFor(pathname);
  await Promise.all([
    fs.mkdir(htmlDir, { recursive: true }),
    fs.mkdir(metadataDir, { recursive: true }),
  ]);
  const nextMetadata = {
    schemaVersion: 1,
    pathname,
    sourceUrl: new URL(pathname, ORIGIN).toString(),
    fetchedAt: new Date().toISOString(),
    ...metadata,
  };
  await Promise.all([
    fs.writeFile(files.html, html),
    fs.writeFile(files.meta, `${JSON.stringify(nextMetadata, null, 2)}\n`),
  ]);
  return { html, metadata: nextMetadata, cache: 'updated' };
};

export const fetchOriginHtml = async (target, headers = {}) => {
  const response = await fetch(target, {
    headers: { accept: 'text/html', 'user-agent': 'aihero-zh/0.2', ...headers },
    redirect: 'manual',
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${target}`);
  return { response, html };
};

export const getPageHtml = async (pathname, { forceOrigin = false } = {}) => {
  const cached = await readCached(pathname);
  const ageSeconds = cached?.metadata?.fetchedAt
    ? (Date.now() - Date.parse(cached.metadata.fetchedAt)) / 1000
    : Infinity;
  const snapshotOnly = PAGE_MODE === 'snapshot' && !forceOrigin;
  if (cached && (snapshotOnly || ageSeconds < CACHE_TTL_SECONDS)) {
    return { ...cached, cache: snapshotOnly ? 'snapshot' : 'fresh' };
  }
  if (snapshotOnly && !cached) throw new Error(`No local snapshot for ${pathname}. Run npm run sync-pages first.`);
  if (pending.has(pathname)) return pending.get(pathname);
  const task = (async () => {
    try {
      const target = new URL(pathname, ORIGIN);
      const { response, html } = await fetchOriginHtml(target);
      return writeCachedPage(pathname, html, {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      });
    } catch (error) {
      if (cached) return { ...cached, cache: 'stale' };
      throw error;
    } finally {
      pending.delete(pathname);
    }
  })();
  pending.set(pathname, task);
  return task;
};
