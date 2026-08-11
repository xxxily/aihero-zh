import fs from 'node:fs/promises';
import path from 'node:path';
import { CACHE_ROOT, CONTENT_ROOT, ORIGIN } from '../src/config.mjs';
import { extractPageSnapshot, slugForPath } from '../src/lib/source.mjs';

const htmlDir = path.join(CACHE_ROOT, 'html');
const metaDir = path.join(CACHE_ROOT, 'meta');
const sourceDir = path.join(CONTENT_ROOT, 'source');
await fs.mkdir(sourceDir, { recursive: true });
const files = (await fs.readdir(metaDir)).filter((name) => name.endsWith('.json'));
const results = [];

for (const file of files) {
  const metadata = JSON.parse(await fs.readFile(path.join(metaDir, file), 'utf8'));
  const pathname = metadata.pathname;
  const html = await fs.readFile(path.join(htmlDir, `${slugForPath(pathname)}.html`), 'utf8');
  const snapshot = extractPageSnapshot({ html, sourceUrl: new URL(pathname, ORIGIN).toString(), pathname });
  snapshot.fetchedAt = metadata.fetchedAt || snapshot.fetchedAt;
  snapshot.etag = metadata.etag || null;
  snapshot.lastModified = metadata.lastModified || null;
  await fs.writeFile(path.join(sourceDir, `${slugForPath(pathname)}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  results.push({ pathname, strings: snapshot.strings.length, textHash: snapshot.textHash });
}

const manifest = {
  schemaVersion: 2,
  origin: ORIGIN,
  fetchedAt: new Date().toISOString(),
  scope: 'cached-pages',
  urls: results.map(({ pathname }) => pathname).sort(),
  results: results.sort((left, right) => left.pathname.localeCompare(right.pathname)),
};
await fs.writeFile(path.join(sourceDir, 'sitemap.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`从页面缓存生成 ${results.length} 个原文快照，共 ${results.reduce((sum, item) => sum + item.strings, 0)} 条页面文本。`);
