import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT } from '../src/config.mjs';

const batchesDir = path.join(CONTENT_ROOT, 'translations/batches');
const primaryPath = path.join(CONTENT_ROOT, 'translations/primary.json');
const files = (await fs.readdir(batchesDir)).filter((name) => name.endsWith('.json')).sort();
const exact = {};
const routes = {};
const blocks = {};
const blockAliases = [];
const conflicts = [];
let reviewedAt = null;

const merge = (target, incoming, scope) => {
  for (const [source, translation] of Object.entries(incoming || {})) {
    if (!source.trim() || typeof translation !== 'string' || !translation.trim()) {
      throw new Error(`Invalid translation in ${scope}: ${source}`);
    }
    if (target[source] && target[source] !== translation) {
      conflicts.push({ scope, source, current: target[source], incoming: translation });
    }
    target[source] = translation;
  }
};

for (const file of files) {
  const batch = JSON.parse(await fs.readFile(path.join(batchesDir, file), 'utf8'));
  if (batch.status !== 'primary-agent-reviewed' || batch.reviewedBy !== 'Codex') {
    throw new Error(`${file} is not marked primary-agent-reviewed by Codex`);
  }
  merge(exact, batch.exact, file);
  for (const [route, translations] of Object.entries(batch.routes || {})) {
    if (!route.startsWith('/')) throw new Error(`Invalid route in ${file}: ${route}`);
    routes[route] ||= {};
    merge(routes[route], translations, `${file}:${route}`);
  }
  for (const [route, translations] of Object.entries(batch.blocks || {})) {
    if (!route.startsWith('/')) throw new Error(`Invalid block route in ${file}: ${route}`);
    blocks[route] ||= {};
    merge(blocks[route], translations, `${file}:${route}:blocks`);
  }
  for (const [aliasRoute, sourceRoute] of Object.entries(batch.blockAliases || {})) {
    if (!aliasRoute.startsWith('/') || typeof sourceRoute !== 'string' || !sourceRoute.startsWith('/')) {
      throw new Error(`Invalid block alias in ${file}: ${aliasRoute} -> ${sourceRoute}`);
    }
    blockAliases.push({ file, aliasRoute, sourceRoute });
  }
  if (batch.reviewedAt && (!reviewedAt || batch.reviewedAt > reviewedAt)) reviewedAt = batch.reviewedAt;
}

for (const { file, aliasRoute, sourceRoute } of blockAliases) {
  if (!blocks[sourceRoute]) throw new Error(`Missing block alias source in ${file}: ${sourceRoute}`);
  blocks[aliasRoute] ||= {};
  merge(blocks[aliasRoute], blocks[sourceRoute], `${file}:${aliasRoute}:block-alias(${sourceRoute})`);
}

if (conflicts.length) throw new Error(`Translation conflicts:\n${JSON.stringify(conflicts, null, 2)}`);
const sortEntries = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
const primary = {
  schemaVersion: 1,
  locale: 'zh-CN',
  sourceLocale: 'en',
  status: 'primary-agent-reviewed',
  reviewedBy: 'Codex',
  reviewedAt,
  scope: '首次完整中文翻译库；仅收录主代理逐条翻译或审校的批次',
  batches: files.map((file) => `batches/${file}`),
  exact: sortEntries(exact),
  routes: Object.fromEntries(Object.entries(routes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, translations]) => [route, sortEntries(translations)])),
  blocks: Object.fromEntries(Object.entries(blocks)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, translations]) => [route, sortEntries(translations)])),
};
const temp = `${primaryPath}.tmp`;
await fs.writeFile(temp, `${JSON.stringify(primary, null, 2)}\n`);
await fs.rename(temp, primaryPath);
const scopedCount = Object.values(routes).reduce((sum, translations) => sum + Object.keys(translations).length, 0);
const blockCount = Object.values(blocks).reduce((sum, translations) => sum + Object.keys(translations).length, 0);
console.log(`重建 primary：${files.length} 个审核批次，${Object.keys(exact).length} 条全局译文，${scopedCount} 条路由译文，${blockCount} 个富文本块。`);
