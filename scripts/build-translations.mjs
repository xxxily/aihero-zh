import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT } from '../src/config.mjs';
import { isTechnicalText, slugForPath } from '../src/lib/source.mjs';

const readJson = async (filePath, fallback = {}) => {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return fallback; }
};
const sourceDir = path.join(CONTENT_ROOT, 'source');
const generatedDir = path.join(CONTENT_ROOT, 'translations/generated');
const primary = await readJson(path.join(CONTENT_ROOT, 'translations/primary.json'), { exact: {} });
const common = await readJson(path.join(CONTENT_ROOT, 'translations/common.json'), { exact: {} });
const home = await readJson(path.join(CONTENT_ROOT, 'translations/home.json'), { exact: {} });
const skills = await readJson(path.join(CONTENT_ROOT, 'translations/skills-vendor.json'), { exact: {} });
await fs.mkdir(generatedDir, { recursive: true });
const files = (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.json') && name !== 'sitemap.json');
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), pages: [] };

for (const file of files) {
  const snapshot = await readJson(path.join(sourceDir, file));
  if (!snapshot.pathname || !Array.isArray(snapshot.strings)) continue;
  const inherited = {
    ...(common.exact || {}),
    ...(snapshot.pathname === '/' ? home.exact || {} : {}),
    ...(snapshot.pathname === '/skills' || snapshot.pathname.startsWith('/skills-') || snapshot.pathname.startsWith('/skills/') ? skills.exact || {} : {}),
  };
  const scoped = primary.routes?.[snapshot.pathname] || {};
  const blocks = primary.blocks?.[snapshot.pathname] || {};
  const blockSources = Object.keys(blocks);
  // Route-scoped entries may intentionally target short DOM fragments such as
  // "tokens" or "'s" that source extraction classifies as technical text.
  const exact = { ...scoped };
  let reviewable = 0;
  let covered = 0;
  for (const { text } of snapshot.strings) {
    if (scoped[text]) exact[text] = scoped[text];
    if (isTechnicalText(text)) continue;
    reviewable += 1;
    const translation = scoped[text] || inherited[text] || primary.exact?.[text];
    if (translation) {
      exact[text] = translation;
      covered += 1;
    } else if (blockSources.some((source) => source === text || source.includes(text))) {
      covered += 1;
    }
  }
  const title = scoped[snapshot.title] || inherited[snapshot.title] || primary.exact?.[snapshot.title] || null;
  await fs.writeFile(path.join(generatedDir, `${slugForPath(snapshot.pathname)}.json`), `${JSON.stringify({
    schemaVersion: 1,
    pathname: snapshot.pathname,
    sourceTitle: snapshot.title,
    title,
    reviewedAt: primary.reviewedAt || null,
    translationSource: 'primary-agent-reviewed',
    status: covered === reviewable ? 'complete' : 'partial',
    exact,
    blocks,
    contains: [],
  }, null, 2)}\n`);
  report.pages.push({ pathname: snapshot.pathname, reviewable, covered, missing: reviewable - covered, percentage: reviewable ? Math.round(covered / reviewable * 100) : 100 });
}

report.pageCount = report.pages.length;
report.completePages = report.pages.filter((page) => page.missing === 0).length;
report.reviewable = report.pages.reduce((sum, page) => sum + page.reviewable, 0);
report.covered = report.pages.reduce((sum, page) => sum + page.covered, 0);
report.missing = report.reviewable - report.covered;
report.percentage = report.reviewable ? Math.round(report.covered / report.reviewable * 100) : 100;
await fs.writeFile(path.join(CONTENT_ROOT, 'reports/translation-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`译文构建：${report.pageCount} 页，覆盖 ${report.covered}/${report.reviewable}（${report.percentage}%），完整页面 ${report.completePages}/${report.pageCount}`);
