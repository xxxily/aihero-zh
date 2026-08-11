import fs from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { CONTENT_ROOT, PROJECT_ROOT } from '../src/config.mjs';
import { isTechnicalText, normalizeText } from '../src/lib/source.mjs';

const readJson = async (file, fallback = {}) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};
const exactFrom = async (name) => (await readJson(path.join(CONTENT_ROOT, 'translations', name))).exact || {};
const sourceDir = path.join(CONTENT_ROOT, 'source');
const reportPath = path.join(CONTENT_ROOT, 'reports/translation-quality.json');
const strict = process.argv.includes('--strict');
const [common, home, skills, primary, config] = await Promise.all([
  exactFrom('common.json'), exactFrom('home.json'), exactFrom('skills-vendor.json'),
  readJson(path.join(CONTENT_ROOT, 'translations/primary.json'), { exact: {}, routes: {} }),
  readJson(path.join(PROJECT_ROOT, 'config/translation.json')),
]);
const globalDictionary = { ...common, ...home, ...skills, ...(primary.exact || {}) };
const preserveTerms = [...new Set([
  ...(config.preserveTerms || []), 'AI', 'LLM', 'MCP', 'GPT-5.x', 'Claude Opus 4.x', 'Sonnet', 'Opus',
])];

const all = (pattern, text) => [...String(text).matchAll(pattern)].map((match) => match[0]);
const multiset = (items) => items.reduce((map, item) => map.set(item, (map.get(item) || 0) + 1), new Map());
const missingFrom = (source, translation, pattern, normalize = (value) => value) => {
  const sourceSet = multiset(all(pattern, source));
  const translationSet = multiset(all(pattern, translation));
  return [...sourceSet.entries()]
    .filter(([token, count]) => {
      const equivalent = [...translationSet.entries()]
        .filter(([candidate]) => normalize(candidate) === normalize(token))
        .reduce((sum, [, candidateCount]) => sum + candidateCount, 0);
      return equivalent < count;
    })
    .flatMap(([token, count]) => Array(Math.max(0, count - [...translationSet.entries()]
      .filter(([candidate]) => normalize(candidate) === normalize(token))
      .reduce((sum, [, candidateCount]) => sum + candidateCount, 0))).fill(token));
};

const checks = [];
const sourceSet = new Set();
const seenPairs = new Set();
const missingBySource = new Map();
const violations = [];
const warnings = [];
let coveredByRichTextBlocks = 0;
for (const file of (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.json') && name !== 'sitemap.json')) {
  const snapshot = await readJson(path.join(sourceDir, file));
  const dictionary = { ...globalDictionary, ...(primary.routes?.[snapshot.pathname] || {}) };
  const blockSources = Object.keys(primary.blocks?.[snapshot.pathname] || {}).map(normalizeText);
  for (const entry of snapshot.strings || []) {
    const source = normalizeText(entry.text);
    if (!source || isTechnicalText(source)) continue;
    sourceSet.add(source);
    const pair = `${snapshot.pathname}\0${source}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const translation = dictionary[source];
    if (!translation) {
      if (blockSources.some((blockSource) => blockSource === source || blockSource.includes(source))) {
        coveredByRichTextBlocks += 1;
        continue;
      }
      const item = missingBySource.get(source) || { source, routes: [] };
      if (!item.routes.includes(snapshot.pathname)) item.routes.push(snapshot.pathname);
      missingBySource.set(source, item);
      continue;
    }
    if (!String(translation).trim()) {
      violations.push({ type: 'empty', source, route: snapshot.pathname });
      continue;
    }
    const urls = missingFrom(source, translation, /https?:\/\/[^\s)>'"”]+/gi);
    const commands = missingFrom(source, translation, /`[^`]+`|\B\/[a-z][a-z0-9-]*(?:\/[a-z0-9._-]+)*/gi);
    const placeholders = missingFrom(source, translation, /\{\{?[^{}]+\}?\}|\$[A-Z][A-Z0-9_]*|%[sd]/g);
    const versions = missingFrom(source, translation, /\bv?\d+(?:\.\d+)+(?:[-\w.]*)?/gi, (value) => value.replace(/[.,]+$/g, ''));
    const numbers = missingFrom(
      source,
      translation,
      /\b\d+(?:,\d{3})*(?:\.\d+)?\b/gi,
      (value) => value.replaceAll(',', ''),
    );
    if (urls.length || commands.length || placeholders.length || versions.length) {
      violations.push({ type: 'preservation', source, translation, route: snapshot.pathname, missing: { urls, commands, placeholders, versions } });
    }
    if (numbers.length) {
      warnings.push({ type: 'numeric-style', source, translation, route: snapshot.pathname, sourceNumbers: numbers });
    }
    const missingTerms = preserveTerms.filter((term) => source.includes(term) && !String(translation).includes(term));
    if (missingTerms.length) violations.push({ type: 'preserve-term', source, translation, route: snapshot.pathname, missingTerms });
    checks.push({ source, translation, route: snapshot.pathname });
  }
}

for (const [route, routeBlocks] of Object.entries(primary.blocks || {})) {
  for (const [source, html] of Object.entries(routeBlocks || {})) {
    if (!String(html).trim()) {
      violations.push({ type: 'empty-block', route, source });
      continue;
    }
    const { document } = parseHTML(`<div>${html}</div>`);
    const invalidTags = [...document.querySelectorAll('*')]
      .map((element) => element.tagName)
      .filter((tag) => !['DIV', 'A', 'EM', 'STRONG', 'CODE', 'BR'].includes(tag));
    const invalidLinks = [...document.querySelectorAll('a')]
      .map((element) => element.getAttribute('href') || '')
      .filter((href) => !href.startsWith('/') || href.startsWith('//'));
    const plain = normalizeText(document.documentElement?.textContent || document.textContent);
    const versions = missingFrom(source, plain, /\bv?\d+(?:\.\d+)+(?:[-\w.]*)?/gi, (value) => value.replace(/[.,]+$/g, ''));
    const urls = missingFrom(source, plain, /https?:\/\/[^\s)>'"”]+/gi);
    const missingTerms = preserveTerms.filter((term) => source.includes(term) && !plain.includes(term));
    if (invalidTags.length || invalidLinks.length || versions.length || urls.length || missingTerms.length) {
      violations.push({ type: 'block-quality', route, source, missing: { invalidTags, invalidLinks, versions, urls, missingTerms } });
    }
  }
}

const missing = [...missingBySource.values()];
const failed = violations.length || (strict && missing.length);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: failed ? 'failed' : (missing.length ? 'passed-with-gaps' : 'passed'),
  strict,
  uniqueSourceTexts: sourceSet.size,
  translated: checks.length,
  coveredByRichTextBlocks,
  missing: missing.length,
  violations: violations.length,
  warnings: warnings.length,
  richTextBlocks: Object.values(primary.blocks || {}).reduce((sum, routeBlocks) => sum + Object.keys(routeBlocks || {}).length, 0),
  examples: { missing: missing.slice(0, 50), violations: violations.slice(0, 50), warnings: warnings.slice(0, 50) },
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`翻译质量门禁：${checks.length} 条逐项检查，${coveredByRichTextBlocks} 条由富文本块覆盖，${violations.length} 个问题，${missing.length} 条待翻译${strict ? '（严格模式）' : ''}`);
if (failed) {
  console.error(`详见 ${path.relative(PROJECT_ROOT, reportPath)}`);
  process.exitCode = 1;
}
