import fs from 'node:fs/promises';
import { includeRequiredRoutes, ORIGIN } from '../src/config.mjs';
import { fetchOriginHtml, writeCachedPage } from '../src/lib/page-cache.mjs';

const valueFor = (name, fallback = null) => {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};
const all = process.argv.includes('--all') || valueFor('scope') === 'all';
const concurrency = Number(valueFor('concurrency', '4'));
const limit = Number(valueFor('limit', '0')) || Infinity;
const route = valueFor('route');

const sitemapResponse = await fetch(`${ORIGIN}/sitemap.xml`, { headers: { 'user-agent': 'aihero-zh-maintainer/0.2' } });
const sitemapXml = await sitemapResponse.text();
if (!sitemapResponse.ok) throw new Error(`${sitemapResponse.status} ${ORIGIN}/sitemap.xml`);
const allPaths = includeRequiredRoutes(
  [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname),
);
let paths = route ? [route] : allPaths;
if (!all && !route) {
  const manifest = JSON.parse(await fs.readFile(new URL('../content/source/sitemap.json', import.meta.url), 'utf8'));
  // The source manifest can predate newly-added non-sitemap index routes.
  // Re-apply the required route set here so a normal sync repairs those pages
  // without requiring a one-off --route command or a full-site refresh.
  paths = includeRequiredRoutes(manifest.urls || []);
}
paths = paths.slice(0, limit);
const results = [];

for (let index = 0; index < paths.length; index += concurrency) {
  const batch = paths.slice(index, index + concurrency);
  results.push(...await Promise.all(batch.map(async (pathname) => {
    try {
      const target = new URL(pathname, ORIGIN);
      const { response, html } = await fetchOriginHtml(target);
      await writeCachedPage(pathname, html, {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentLength: Buffer.byteLength(html),
      });
      return { pathname, status: 'ok', bytes: Buffer.byteLength(html) };
    } catch (error) {
      return { pathname, status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  })));
  console.log(`页面快照 ${Math.min(index + batch.length, paths.length)}/${paths.length}`);
}

const report = {
  schemaVersion: 1,
  origin: ORIGIN,
  scope: all ? 'all' : route ? 'route' : 'tracked',
  syncedAt: new Date().toISOString(),
  pageCount: paths.length,
  ok: results.filter((item) => item.status === 'ok').length,
  failed: results.filter((item) => item.status === 'error').length,
  results,
};
await fs.writeFile(new URL('../content/reports/page-sync.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(`完成：${report.ok} 个页面，${report.failed} 个失败`);
if (report.failed) process.exitCode = 2;
