import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOT, includeRequiredRoutes, ORIGIN, REPORT_ROOT, TRACKED_ROUTE_PATTERNS } from '../src/config.mjs';
import { diffStrings, coverageFor } from '../src/lib/diff.mjs';
import { extractPageSnapshot, slugForPath } from '../src/lib/source.mjs';

const args = new Set(process.argv.slice(2));
const all = args.has('--all') || args.has('--scope=all');
const snapshotsDir = path.join(CONTENT_ROOT, 'source');

const readJson = async (filePath, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const fetchPage = async (url) => {
  const response = await fetch(url, { headers: { 'user-agent': 'aihero-zh-maintainer/0.1', accept: 'text/html' } });
  const html = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return extractPageSnapshot({ html, sourceUrl: url, pathname: new URL(url).pathname });
};

const sitemapResponse = await fetch(`${ORIGIN}/sitemap.xml`, { headers: { 'user-agent': 'aihero-zh-maintainer/0.1' } });
const sitemapXml = await sitemapResponse.text();
const selected = includeRequiredRoutes(
  [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname),
)
  .map((pathname) => new URL(pathname, ORIGIN))
  .filter((url) => all || TRACKED_ROUTE_PATTERNS.some((pattern) => pattern.test(url.pathname)));

const pages = [];
for (const url of selected) {
  try {
    const current = await fetchPage(url.toString());
    const previous = await readJson(path.join(snapshotsDir, `${slugForPath(url.pathname)}.json`), { strings: [] });
    const diff = diffStrings(previous.strings || [], current.strings || []);
    pages.push({ pathname: url.pathname, diff, current });
  } catch (error) {
    pages.push({ pathname: url.pathname, error: error instanceof Error ? error.message : String(error) });
  }
}

const home = pages.find((page) => page.pathname === '/')?.current;
const commonTranslations = await readJson(path.join(CONTENT_ROOT, 'translations', 'common.json'), { exact: {} });
const homeTranslations = await readJson(path.join(CONTENT_ROOT, 'translations', 'home.json'), { exact: {} });
const coverage = home ? coverageFor(home, { ...(commonTranslations.exact || {}), ...(homeTranslations.exact || {}) }) : null;
const changedPages = pages.filter((page) => page.error || page.diff?.added.length || page.diff?.removed.length || page.diff?.changed.length);
const untranslated = pages.reduce((total, page) => total + (page.diff?.added.length || 0), 0);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  scope: all ? 'all' : 'tracked',
  pageCount: pages.length,
  changedPages: changedPages.length,
  untranslated,
  homeCoverage: coverage,
  pages: pages.map(({ pathname, diff, error }) => ({
    pathname,
    error,
    diff: diff ? {
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      unchangedCount: diff.unchanged.length,
    } : undefined,
  })),
};

await fs.mkdir(REPORT_ROOT, { recursive: true });
await fs.mkdir(path.join(CONTENT_ROOT, 'reports'), { recursive: true });
await fs.writeFile(path.join(REPORT_ROOT, 'upstream-update.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(CONTENT_ROOT, 'reports', 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# AI Hero 上游更新报告',
  '',
  `生成时间：${report.generatedAt}`,
  `范围：${report.scope}，检查 ${report.pageCount} 个页面`,
  `变化页面：${report.changedPages}，新增/待翻译文本：${report.untranslated}`,
  coverage ? `首页译文覆盖率：${coverage.percentage}%（${coverage.covered}/${coverage.total}）` : '',
  '',
  ...changedPages.flatMap((page) => [
    `## ${page.pathname}`,
    page.error ? `- 抓取失败：${page.error}` : `- 新增：${page.diff.added.length}，变更：${page.diff.changed.length}，删除：${page.diff.removed.length}`,
    ...(page.diff?.changed || []).slice(0, 12).map((item) => `- 变更：${item.before.text} → ${item.after.text}`),
    ...(page.diff?.added || []).slice(0, 12).map((item) => `- 待翻译：${item.text}`),
    '',
  ]),
].filter(Boolean).join('\n');
await fs.writeFile(path.join(REPORT_ROOT, 'upstream-update.md'), `${markdown}\n`);
console.log(markdown);

if (args.has('--ci') && changedPages.length) process.exitCode = 2;
