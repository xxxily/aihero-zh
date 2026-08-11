import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONTENT_ROOT } from '../src/config.mjs';
import { isTechnicalText } from '../src/lib/source.mjs';
import { loadModelConfig, translateBatch } from '../src/lib/model-client.mjs';

const valueFor = (name, fallback = null) => {
  const entry = process.argv.find((value) => value.startsWith(`--${name}=`));
  return entry ? entry.slice(name.length + 3) : fallback;
};
const config = await loadModelConfig(valueFor('config'));
const maxItems = Number(valueFor('max-items', '0')) || Infinity;
const maxRetries = Number(valueFor('retries', '3'));
const sourceDir = path.join(CONTENT_ROOT, 'source');
const memoryPath = path.join(CONTENT_ROOT, 'translations/memory.json');
const readJson = async (filePath, fallback = {}) => {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
};
const memory = await readJson(memoryPath, { exact: {} });
const primary = await readJson(path.join(CONTENT_ROOT, 'translations/primary.json'), { exact: {}, routes: {} });
const known = {
  ...(await readJson(path.join(CONTENT_ROOT, 'translations/common.json'))).exact,
  ...(await readJson(path.join(CONTENT_ROOT, 'translations/home.json'))).exact,
  ...(await readJson(path.join(CONTENT_ROOT, 'translations/skills-vendor.json'))).exact,
  ...(primary.exact || {}),
  ...(memory.exact || {}),
};
const unique = new Map();
for (const file of (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.json') && name !== 'sitemap.json')) {
  const snapshot = await readJson(path.join(sourceDir, file));
  const scoped = primary.routes?.[snapshot.pathname] || {};
  for (const entry of snapshot.strings || []) {
    if (!isTechnicalText(entry.text) && !known[entry.text] && !scoped[entry.text]) unique.set(entry.text, entry.id);
  }
}
const items = [...unique.entries()].slice(0, maxItems).map(([source, id]) => ({ id: id || crypto.createHash('sha256').update(source).digest('hex'), source }));
const batches = [];
for (let index = 0; index < items.length; index += config.batchSize || 100) batches.push(items.slice(index, index + (config.batchSize || 100)));
console.log(`全站唯一待翻译文本：${items.length} 条，${batches.length} 批，并发 ${config.concurrency || 2}`);
const memoryExact = { ...(memory.exact || {}) };
let cursor = 0;
let completed = 0;
const failures = [];
let saveQueue = Promise.resolve();

const save = async () => {
  saveQueue = saveQueue.then(async () => {
    const tempPath = `${memoryPath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify({
      schemaVersion: 1,
      locale: config.locale || 'zh-CN',
      updatedAt: new Date().toISOString(),
      model: { provider: config.provider, model: config.model },
      exact: memoryExact,
    }, null, 2)}\n`);
    await fs.rename(tempPath, memoryPath);
  });
  return saveQueue;
};

const worker = async () => {
  while (cursor < batches.length) {
    const batchIndex = cursor++;
    const batch = batches[batchIndex];
    let translated = null;
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await translateBatch({ items: batch, mode: 'translate', config });
        if (!Array.isArray(result)) throw new Error('模型返回的 items 不是数组');
        translated = result
          .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
          .map((item) => ({
            id: item.id,
            translation: typeof item.translation === 'string'
              ? item.translation.trim()
              : item.translation == null
                ? ''
                : String(item.translation).trim(),
          }));
        break;
      } catch (error) {
        lastError = error;
        console.warn(`批次 ${batchIndex + 1} 第 ${attempt}/${maxRetries} 次失败：${error.message}`);
        if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      }
    }
    if (!translated) {
      failures.push({ batch: batchIndex + 1, items: batch, error: lastError?.message || 'unknown error' });
      await fs.writeFile(path.join(CONTENT_ROOT, 'reports/translation-failures.json'), `${JSON.stringify({
        generatedAt: new Date().toISOString(), failures,
      }, null, 2)}\n`);
      continue;
    }
    const byId = new Map(translated.map((item) => [item.id, item.translation]));
    const missing = batch.filter((item) => !byId.get(item.id));
    for (const item of batch) if (byId.get(item.id)) memoryExact[item.source] = byId.get(item.id);
    if (missing.length) {
      failures.push({ batch: batchIndex + 1, items: missing, error: `模型漏回 ${missing.length}/${batch.length} 条译文，将在下次任务继续` });
    }
    completed += 1;
    await save();
    console.log(`完成批次 ${completed}/${batches.length}（${Object.keys(memoryExact).length} 条记忆，漏回 ${missing.length}）`);
  }
};
await Promise.all(Array.from({ length: Math.min(config.concurrency || 2, batches.length) }, worker));
if (failures.length) {
  await fs.writeFile(path.join(CONTENT_ROOT, 'reports/translation-failures.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), failures,
  }, null, 2)}\n`);
}
console.log(`完成：翻译记忆共 ${Object.keys(memoryExact).length} 条，失败批次 ${failures.length}。`);
if (failures.length) process.exitCode = 2;
