import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT, includeRequiredRoutes, ORIGIN, TRACKED_ROUTE_PATTERNS } from '../src/config.mjs';
import { extractPageSnapshot, slugForPath } from '../src/lib/source.mjs';

const args = new Set(process.argv.slice(2));
const all = args.has('--all') || args.has('--scope=all');
const limitArg = process.argv.find((value) => value.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const sourceDir = path.join(CONTENT_ROOT, 'source');
const reportsDir = path.join(CONTENT_ROOT, 'reports');

const fetchText = async (url) => {
  const response = await fetch(url, { headers: { 'user-agent': 'aihero-zh-maintainer/0.1', accept: 'text/html' } });
  const html = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return { html, response };
};

const sitemap = await fetchText(`${ORIGIN}/sitemap.xml`);
const paths = includeRequiredRoutes(
  [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname),
);
const selected = paths
  .map((pathname) => new URL(pathname, ORIGIN))
  .filter((url) => all || TRACKED_ROUTE_PATTERNS.some((pattern) => pattern.test(url.pathname)))
  .slice(0, limit);

await fs.mkdir(sourceDir, { recursive: true });
await fs.mkdir(reportsDir, { recursive: true });
const results = [];

for (let index = 0; index < selected.length; index += 4) {
  const batch = selected.slice(index, index + 4);
  const batchResults = await Promise.all(batch.map(async (url) => {
    try {
      const { html, response } = await fetchText(url.toString());
      const snapshot = extractPageSnapshot({ html, sourceUrl: url.toString(), pathname: url.pathname });
      snapshot.etag = response.headers.get('etag');
      snapshot.lastModified = response.headers.get('last-modified');
      await fs.writeFile(path.join(sourceDir, `${slugForPath(url.pathname)}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
      return { pathname: url.pathname, status: 'ok', strings: snapshot.strings.length, textHash: snapshot.textHash };
    } catch (error) {
      return { pathname: url.pathname, status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }));
  results.push(...batchResults);
  console.log(`同步 ${Math.min(index + batch.length, selected.length)}/${selected.length}`);
}

const manifest = {
  schemaVersion: 1,
  origin: ORIGIN,
  fetchedAt: new Date().toISOString(),
  scope: all ? 'all' : 'tracked',
  urls: selected.map((url) => url.pathname),
  results,
};
await fs.writeFile(path.join(sourceDir, 'sitemap.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(reportsDir, 'last-sync.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`完成：${results.filter((result) => result.status === 'ok').length} 个页面，${results.filter((result) => result.status === 'error').length} 个失败`);
