import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT } from '../src/config.mjs';

const batchArg = process.argv.find((value) => value.startsWith('--batch='));
if (!batchArg) throw new Error('Usage: node scripts/import-primary-batch.mjs --batch=content/translations/batches/<file>.json');
const batchPath = path.resolve(batchArg.slice('--batch='.length));
const primaryPath = path.join(CONTENT_ROOT, 'translations/primary.json');
const [batch, primary] = await Promise.all([
  fs.readFile(batchPath, 'utf8').then(JSON.parse),
  fs.readFile(primaryPath, 'utf8').then(JSON.parse),
]);
if (batch.status !== 'primary-agent-reviewed' || batch.reviewedBy !== 'Codex') {
  throw new Error('Batch must be marked primary-agent-reviewed and reviewedBy=Codex');
}
const exact = { ...(primary.exact || {}) };
const routes = Object.fromEntries(
  Object.entries(primary.routes || {}).map(([route, translations]) => [route, { ...(translations || {}) }]),
);
const blocks = Object.fromEntries(
  Object.entries(primary.blocks || {}).map(([route, translations]) => [route, { ...(translations || {}) }]),
);
const conflicts = [];
const validateEntry = (source, translation, label) => {
  if (!source.trim() || typeof translation !== 'string' || !translation.trim()) {
    throw new Error(`Invalid translation for ${label}: ${source}`);
  }
};
for (const [source, translation] of Object.entries(batch.exact || {})) {
  validateEntry(source, translation, 'exact');
  if (exact[source] && exact[source] !== translation) conflicts.push({ source, current: exact[source], incoming: translation });
  exact[source] = translation;
}
for (const [route, translations] of Object.entries(batch.routes || {})) {
  if (!route.startsWith('/') || !translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw new Error(`Invalid route translation scope: ${route}`);
  }
  routes[route] ||= {};
  for (const [source, translation] of Object.entries(translations)) {
    validateEntry(source, translation, route);
    if (routes[route][source] && routes[route][source] !== translation) {
      conflicts.push({ route, source, current: routes[route][source], incoming: translation });
    }
    routes[route][source] = translation;
  }
}
for (const [route, translations] of Object.entries(batch.blocks || {})) {
  if (!route.startsWith('/') || !translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw new Error(`Invalid route block scope: ${route}`);
  }
  blocks[route] ||= {};
  for (const [source, translationHtml] of Object.entries(translations)) {
    validateEntry(source, translationHtml, `${route}:block`);
    if (blocks[route][source] && blocks[route][source] !== translationHtml) {
      conflicts.push({ route, source, current: blocks[route][source], incoming: translationHtml, type: 'block' });
    }
    blocks[route][source] = translationHtml;
  }
}
if (conflicts.length) throw new Error(`Translation conflicts:\n${JSON.stringify(conflicts, null, 2)}`);
const next = {
  ...primary,
  reviewedAt: new Date().toISOString().slice(0, 10),
  batches: [...new Set([...(primary.batches || []), path.relative(path.dirname(primaryPath), batchPath)])],
  exact: Object.fromEntries(Object.entries(exact).sort(([left], [right]) => left.localeCompare(right))),
  routes: Object.fromEntries(Object.entries(routes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, translations]) => [route, Object.fromEntries(Object.entries(translations).sort(([left], [right]) => left.localeCompare(right)))])),
  blocks: Object.fromEntries(Object.entries(blocks)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, translations]) => [route, Object.fromEntries(Object.entries(translations).sort(([left], [right]) => left.localeCompare(right)))])),
};
const temp = `${primaryPath}.tmp`;
await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
await fs.rename(temp, primaryPath);
const scopedCount = Object.values(batch.routes || {}).reduce((sum, translations) => sum + Object.keys(translations || {}).length, 0);
const blockCount = Object.values(batch.blocks || {}).reduce((sum, translations) => sum + Object.keys(translations || {}).length, 0);
console.log(`合并 ${Object.keys(batch.exact || {}).length} 条全局译文、${scopedCount} 条路由译文、${blockCount} 个富文本块；primary 全局总计 ${Object.keys(next.exact).length} 条。`);
