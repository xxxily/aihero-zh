import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT } from '../src/config.mjs';
import { isTechnicalText, normalizeText } from '../src/lib/source.mjs';

const read = async (file, fallback = {}) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};
const primary = await read(path.join(CONTENT_ROOT, 'translations/primary.json'), { exact: {} });
const common = await read(path.join(CONTENT_ROOT, 'translations/common.json'), { exact: {} });
const home = await read(path.join(CONTENT_ROOT, 'translations/home.json'), { exact: {} });
const skills = await read(path.join(CONTENT_ROOT, 'translations/skills-vendor.json'), { exact: {} });
const known = { ...common.exact, ...home.exact, ...skills.exact, ...primary.exact };
const byText = new Map();
for (const file of (await fs.readdir(path.join(CONTENT_ROOT, 'source'))).filter((name) => name.endsWith('.json') && name !== 'sitemap.json')) {
  const snapshot = await read(path.join(CONTENT_ROOT, 'source', file));
  const scoped = primary.routes?.[snapshot.pathname] || {};
  const blockSources = Object.keys(primary.blocks?.[snapshot.pathname] || {}).map(normalizeText);
  for (const entry of snapshot.strings || []) {
    const source = normalizeText(entry.text);
    const coveredByBlock = blockSources.some((blockSource) => blockSource === source || blockSource.includes(source));
    if (known[entry.text] || scoped[entry.text] || isTechnicalText(entry.text) || coveredByBlock) continue;
    const record = byText.get(entry.text) || { source: entry.text, routes: [], count: 0 };
    if (!record.routes.includes(snapshot.pathname)) record.routes.push(snapshot.pathname);
    record.count += 1;
    byText.set(entry.text, record);
  }
}
const queue = [...byText.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
const limit = Number(process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1] || 0) || queue.length;
const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: 'primary-agent-translation-queue',
  total: queue.length,
  items: queue.slice(0, limit),
};
await fs.writeFile(path.join(CONTENT_ROOT, 'reports/translation-queue.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(`生成主代理翻译队列：${output.total} 条唯一文本；已写入 content/reports/translation-queue.json`);
