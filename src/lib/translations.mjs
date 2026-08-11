import fs from 'node:fs/promises';
import {
  COMMON_TRANSLATION_FILE,
  CONTENT_ROOT,
  GENERATED_TRANSLATIONS_DIR,
  ROUTE_TRANSLATIONS,
  SKILLS_TRANSLATION_FILE,
  isSkillsRoute,
  normalizeRoute,
} from '../config.mjs';
import { slugForPath } from './source.mjs';

const readJson = async (filePath, fallback = {}) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

export const loadTranslationsFor = async (pathname) => {
  const common = await readJson(COMMON_TRANSLATION_FILE);
  // Keep globally reviewed entries available at runtime even when a piece of
  // UI is inserted by Next.js after the cached HTML snapshot was extracted.
  // Route-generated dictionaries intentionally contain only snapshot text,
  // so without this layer dynamic newsletter, share and action labels can
  // remain English despite already having a reviewed primary translation.
  const primary = await readJson(`${CONTENT_ROOT}/translations/primary.json`);
  const route = normalizeRoute(pathname);
  const routeFile = ROUTE_TRANSLATIONS.get(route);
  const specific = routeFile ? await readJson(routeFile) : {};
  const generated = await readJson(`${GENERATED_TRANSLATIONS_DIR}/${slugForPath(route)}.json`);
  const skills = isSkillsRoute(route) && !generated.exact
    ? await readJson(SKILLS_TRANSLATION_FILE)
    : {};
  const title = generated.title || specific.title || common.title;
  const sourceTitle = generated.sourceTitle || specific.sourceTitle || common.sourceTitle;
  return {
    route,
    title,
    sourceTitle,
    exact: {
      ...(common.exact || {}),
      ...(skills.exact || {}),
      ...(primary.exact || {}),
      ...(primary.routes?.[route] || {}),
      ...(generated.exact || {}),
      ...(specific.exact || {}),
      ...(title && sourceTitle ? { [sourceTitle]: title } : {}),
    },
    contains: [
      ...(common.contains || []),
      ...(skills.contains || []),
      ...(generated.contains || []),
      ...(specific.contains || []),
    ],
    blocks: {
      ...(generated.blocks || {}),
      ...(specific.blocks || {}),
    },
    meta: {
      source: 'https://www.aihero.dev',
      reviewedAt: specific.reviewedAt || generated.reviewedAt || skills.reviewedAt || common.reviewedAt || null,
      scope: specific.scope || generated.scope || common.scope || 'public chrome',
    },
  };
};

export const loadStatus = async () => {
  const manifest = await readJson(`${CONTENT_ROOT}/manifest.json`, {});
  const report = await readJson(`${CONTENT_ROOT}/reports/latest.json`, null);
  return { manifest, report };
};
