import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT } from '../src/config.mjs';
import { isTechnicalText } from '../src/lib/source.mjs';
import { loadTranslationsFor } from '../src/lib/translations.mjs';
import { loadModelConfig, translateBatch } from '../src/lib/model-client.mjs';

const valueFor = (name, fallback = null) => {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);
const mode = valueFor('mode', 'translate');
const routeFilter = valueFor('route');
const limit = Number(valueFor('limit', '0')) || Infinity;
const maxItems = Number(valueFor('max-items', '0')) || Infinity;
const dryRun = has('dry-run');
const config = await loadModelConfig(valueFor('config'));
const sourceDir = path.join(CONTENT_ROOT, 'source');
const memoryPath = path.join(CONTENT_ROOT, 'translations/memory.json');
const files = (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.json') && !['sitemap.json'].includes(name));
let processed = 0;
let memory = {};
try { memory = JSON.parse(await fs.readFile(memoryPath, 'utf8')); } catch {}
const memoryExact = { ...(memory.exact || {}) };

for (const file of files) {
  if (processed >= limit) break;
  const snapshot = JSON.parse(await fs.readFile(path.join(sourceDir, file), 'utf8'));
  if (!snapshot.pathname || (routeFilter && snapshot.pathname !== routeFilter)) continue;
  const inherited = await loadTranslationsFor(snapshot.pathname);
  const current = { ...memoryExact };
  const candidates = (snapshot.strings || []).filter(({ text }) => {
    if (isTechnicalText(text)) return false;
    if (mode === 'review') return Boolean(inherited.exact[text]);
    return !current[text] && !inherited.exact[text];
  });
  const selectedCandidates = candidates.slice(0, maxItems);
  if (!selectedCandidates.length) continue;
  console.log(`${snapshot.pathname}: ${selectedCandidates.length}/${candidates.length} 条${mode === 'review' ? '待校对' : '待翻译'}`);
  if (dryRun) { processed += 1; continue; }
  for (let index = 0; index < selectedCandidates.length; index += config.batchSize || 35) {
    const batch = selectedCandidates.slice(index, index + (config.batchSize || 35)).map(({ id, text }) => ({
      id,
      source: text,
      translation: mode === 'review' ? inherited.exact[text] : undefined,
    }));
    const translated = await translateBatch({ items: batch, mode, config });
    const byId = new Map(translated.map((item) => [item.id, item]));
    for (const source of batch) {
      const item = byId.get(source.id);
      if (item?.translation) {
        current[source.source] = item.translation.trim();
        memoryExact[source.source] = item.translation.trim();
      }
    }
    await fs.writeFile(memoryPath, `${JSON.stringify({
      schemaVersion: 1,
      locale: config.locale || 'zh-CN',
      updatedAt: new Date().toISOString(),
      status: 'machine-draft-not-for-publication',
      model: { provider: config.provider, model: config.model },
      exact: memoryExact,
    }, null, 2)}\n`);
    console.log(`  ${Math.min(index + batch.length, selectedCandidates.length)}/${selectedCandidates.length}`);
  }
  processed += 1;
}

console.log(`完成 ${processed} 个页面。${dryRun ? '（dry-run，未调用模型）' : ''}`);
