import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PROJECT_ROOT = ROOT;
export const CONTENT_ROOT = path.join(ROOT, 'content');
export const REPORT_ROOT = path.join(ROOT, 'reports');
export const VENDOR_ROOT = path.join(ROOT, 'vendor');
export const CACHE_ROOT = path.join(ROOT, process.env.AIHERO_CACHE_DIR || 'content/cache');
export const ASSET_CACHE_ROOT = path.join(ROOT, process.env.AIHERO_ASSET_CACHE_DIR || 'content/cache/assets');
export const ORIGIN = process.env.AIHERO_ORIGIN || 'https://www.aihero.dev';
export const HOST = process.env.AIHERO_ZH_HOST || process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.AIHERO_ZH_PORT || process.env.PORT || 4173);
export const ALLOW_ORIGIN_POST = process.env.AIHERO_ALLOW_ORIGIN_POST !== '0';
export const PAGE_MODE = process.env.AIHERO_PAGE_MODE || 'snapshot';
export const CACHE_TTL_SECONDS = Number(process.env.AIHERO_CACHE_TTL_SECONDS || 86400);
// Safe post-load window for React hydration before mutating text nodes. This is
// a fallback delay, not a model/network wait; translation dictionaries are local.
export const HYDRATION_DELAY_MS = Number(process.env.AIHERO_HYDRATION_DELAY_MS || 3000);
// Keep the initial paint hidden until hydration and the local dictionary have
// settled. These are short, configurable safety windows, not model waits.
export const PAINT_SETTLE_MS = Number(process.env.AIHERO_PAINT_SETTLE_MS || 120);
export const PAINT_TIMEOUT_MS = Number(process.env.AIHERO_PAINT_TIMEOUT_MS || 2500);

export const COMMON_TRANSLATION_FILE = path.join(
  CONTENT_ROOT,
  'translations',
  'common.json',
);

export const ROUTE_TRANSLATIONS = new Map([
  ['/', path.join(CONTENT_ROOT, 'translations', 'home.json')],
]);
export const SKILLS_TRANSLATION_FILE = path.join(CONTENT_ROOT, 'translations', 'skills-vendor.json');
export const PRIMARY_TRANSLATION_FILE = path.join(CONTENT_ROOT, 'translations', 'primary.json');
export const GENERATED_TRANSLATIONS_DIR = path.join(CONTENT_ROOT, 'translations', 'generated');

// These first-party index pages exist on the site but are omitted from the
// upstream sitemap. Keep them in every full snapshot and update check.
export const REQUIRED_ROUTE_PATHS = [
  '/learn',
  '/posts',
  '/open-source',
  // Topic index pages are linked from the site's navigation but omitted from
  // the upstream sitemap. Keep every current "All" page in the first-party
  // snapshot so topic links never fall through to a missing local snapshot.
  '/topics/meta-announcements',
  '/topics/build-a-software-factory',
  '/topics/think-like-an-ai-engineer',
  '/topics/learn-how-llms-think',
  '/topics/set-up-your-agent',
  '/topics/get-better-results',
  '/topics/score-first-wins',
  '/topics/ship-solid-code',
  '/topics/build-the-right-thing',
];

export const TRACKED_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/learn$/,
  /^\/posts$/,
  /^\/open-source$/,
  /^\/skills$/,
  /^\/skills-[a-z0-9-]+$/,
  /^\/topics\/[a-z0-9-]+$/,
];

export const includeRequiredRoutes = (pathnames) => [
  ...new Set([...pathnames, ...REQUIRED_ROUTE_PATHS]),
];

export const isSkillsRoute = (pathname) =>
  pathname === '/skills' || pathname.startsWith('/skills-') || pathname.startsWith('/skills/');

export const isTrackedRoute = (pathname) =>
  TRACKED_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));

export const normalizeRoute = (pathname) => {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
};
