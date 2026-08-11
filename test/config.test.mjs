import test from 'node:test';
import assert from 'node:assert/strict';
import { includeRequiredRoutes, isTrackedRoute, REQUIRED_ROUTE_PATHS } from '../src/config.mjs';

test('keeps non-sitemap index pages in tracked and full route sets', () => {
  assert.deepEqual(REQUIRED_ROUTE_PATHS, [
    '/learn',
    '/posts',
    '/open-source',
    '/topics/meta-announcements',
    '/topics/build-a-software-factory',
    '/topics/think-like-an-ai-engineer',
    '/topics/learn-how-llms-think',
    '/topics/set-up-your-agent',
    '/topics/get-better-results',
    '/topics/score-first-wins',
    '/topics/ship-solid-code',
    '/topics/build-the-right-thing',
  ]);
  assert.deepEqual(includeRequiredRoutes(['/']), ['/', ...REQUIRED_ROUTE_PATHS]);
  for (const pathname of REQUIRED_ROUTE_PATHS) assert.equal(isTrackedRoute(pathname), true);
  assert.equal(isTrackedRoute('/topics/not-yet-in-the-current-navigation'), true);
});
