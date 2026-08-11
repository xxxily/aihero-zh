import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const runtimeSource = await fs.readFile(new URL('../public/translation-runtime.js', import.meta.url), 'utf8');
const navigationRuntimeSource = await fs.readFile(new URL('../public/navigation-runtime.js', import.meta.url), 'utf8');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('mounts concise community links in the upstream header and footer', async () => {
  const { window } = parseHTML(`
    <html><body>
      <aside aria-label="Announcement"><div></div></aside>
      <header>
        <a aria-label="AI Hero home" href="/">AI Hero</a>
        <nav aria-label="Primary navigation"></nav>
        <nav aria-label="User navigation"></nav>
        <div></div>
      </header>
      <main></main>
      <footer></footer>
    </body></html>
  `);
  const testLocation = {
    href: 'http://127.0.0.1:4174/skills?view=all',
    pathname: '/skills',
    search: '?view=all',
    hash: '',
    origin: 'http://127.0.0.1:4174',
  };
  const history = {
    pushState() {},
    replaceState() {},
  };
  const sessionStorage = {
    getItem: () => null,
    removeItem() {},
    setItem() {},
  };
  window.__AIHERO_ZH_CONTEXT__ = {
    origin: 'https://www.aihero.dev',
    repository: 'https://github.com/xxxily/aihero-zh',
  };
  window.__AIHERO_ZH_DICTIONARY_CACHE__ = new Map();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  window.Element = window.HTMLElement || window.Element;

  vm.runInNewContext(navigationRuntimeSource, {
    window,
    document: window.document,
    location: testLocation,
    history,
    sessionStorage,
    URL,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  });
  await wait(30);

  const headerLinks = window.document.querySelector('[data-aihero-community-links]');
  const footerNotice = window.document.querySelector('[data-aihero-community-notice]');
  const topLinks = window.document.querySelector('[data-aihero-community-top-links]');
  assert.equal(headerLinks?.textContent, 'GitHub·原站');
  assert.equal(headerLinks?.querySelector('a')?.getAttribute('href'), 'https://github.com/xxxily/aihero-zh');
  assert.equal(
    headerLinks?.querySelector('[data-aihero-source-link]')?.getAttribute('href'),
    'https://www.aihero.dev/skills?view=all',
  );
  assert.match(footerNotice?.textContent || '', /中文社区翻译/);
  assert.match(footerNotice?.textContent || '', /版权归原站及相关权利人所有/);
  assert.equal(topLinks?.textContent, 'GitHub原站');
  assert.equal(window.document.querySelectorAll('[data-aihero-community-links]').length, 1);
  assert.equal(window.document.querySelectorAll('[data-aihero-community-top-links]').length, 1);
  assert.equal(window.document.querySelectorAll('[data-aihero-community-notice]').length, 1);

  headerLinks.remove();
  topLinks.remove();
  footerNotice.remove();
  await wait(30);
  assert.equal(window.document.querySelectorAll('[data-aihero-community-links]').length, 1);
  assert.equal(window.document.querySelectorAll('[data-aihero-community-top-links]').length, 1);
  assert.equal(window.document.querySelectorAll('[data-aihero-community-notice]').length, 1);

  testLocation.href = 'http://127.0.0.1:4174/the-prompt-report';
  testLocation.pathname = '/the-prompt-report';
  testLocation.search = '';
  window.__AIHERO_ZH_NAVIGATION__.mountCommunityChrome();
  assert.deepEqual(
    [...window.document.querySelectorAll('[data-aihero-source-link]')].map((link) => link.getAttribute('href')),
    Array(3).fill('https://www.aihero.dev/the-prompt-report'),
  );
});

test('re-applies the local dictionary after hydration replaces text and attributes', async () => {
  const { window } = parseHTML('<html><body><a id="login">Log in</a><input id="name" placeholder="Name"></body></html>');
  window.__AIHERO_ZH_CONTEXT__ = {
    route: '/learn',
    origin: 'https://www.aihero.dev',
    serverRendered: true,
    paintSettleMs: 0,
    paintTimeoutMs: 100,
  };
  window.__AIHERO_ZH_DICTIONARY_CACHE__ = new Map();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.fetch = async () => ({
    ok: true,
    json: async () => ({
      exact: {
        'Log in': '登录',
        Name: '姓名',
        AI: 'AI',
      },
      blocks: {},
    }),
  });
  window.NodeFilter = { SHOW_TEXT: 4 };
  window.Element = window.HTMLElement || window.Element;

  vm.runInNewContext(runtimeSource, {
    window,
    document: window.document,
    location: window.location,
    URL,
    Element: window.Element,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    fetch: window.fetch,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    console,
  });
  await wait(80);

  assert.equal(window.document.querySelector('#login').textContent, '登录');
  assert.equal(window.document.querySelector('#name').getAttribute('placeholder'), '姓名');

  window.document.querySelector('#login').textContent = 'Log in';
  window.document.querySelector('#name').setAttribute('placeholder', 'Name');
  await wait(30);

  assert.equal(window.document.querySelector('#login').textContent, '登录');
  assert.equal(window.document.querySelector('#name').getAttribute('placeholder'), '姓名');
  assert.equal(window.document.documentElement.lang, 'zh-CN');
});

test('loads the destination dictionary after client-side route changes', async () => {
  const { window } = parseHTML('<html><body><main><h1 id="title">Learn</h1></main></body></html>');
  const testLocation = {
    href: 'http://127.0.0.1:4174/learn',
    pathname: '/learn',
  };
  window.__AIHERO_ZH_CONTEXT__ = {
    route: '/learn',
    origin: 'https://www.aihero.dev',
    serverRendered: true,
    paintSettleMs: 0,
    paintTimeoutMs: 100,
  };
  window.__AIHERO_ZH_DICTIONARY_CACHE__ = new Map();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  const requests = [];
  window.fetch = async (input) => {
    requests.push(String(input));
    return ({
      ok: true,
      json: async () => String(input).includes('%2Fposts')
        ? { exact: { Posts: '文章' }, blocks: {} }
        : { exact: { Learn: '学习' }, blocks: {} },
    });
  };
  window.NodeFilter = { SHOW_TEXT: 4 };
  window.Element = window.HTMLElement || window.Element;

  vm.runInNewContext(runtimeSource, {
    window,
    document: window.document,
    location: testLocation,
    URL,
    Element: window.Element,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    fetch: window.fetch,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    console,
  });
  await wait(80);
  assert.match(requests[0] || '', /%2Flearn/);
  assert.equal(window.document.querySelector('#title').textContent, '学习');

  testLocation.href = 'http://127.0.0.1:4174/posts';
  testLocation.pathname = '/posts';
  window.document.querySelector('#title').textContent = 'Posts';
  window.dispatchEvent(new window.CustomEvent('aihero:route-change', {
    detail: { route: '/posts', trigger: 'pushState' },
  }));
  await wait(100);

  assert.equal(window.document.querySelector('#title').textContent, '文章');
  assert.equal(window.document.documentElement.dataset.aiheroZhRoute, '/posts');
  assert.equal(window.document.documentElement.dataset.aiheroZhReady, 'true');
});

test('translates visible sidebar overflow labels without translating hidden aria copies', async () => {
  const sourceTitle = 'Messages, System Prompts and Reasoning Tokens';
  const translatedTitle = '消息、系统提示词与推理 Token';
  const { window } = parseHTML(`<html><body><span id="hidden" aria-hidden="true">${sourceTitle}</span></body></html>`);
  window.__AIHERO_ZH_CONTEXT__ = {
    route: '/what-are-tools',
    origin: 'https://www.aihero.dev',
    serverRendered: true,
    paintSettleMs: 0,
    paintTimeoutMs: 100,
  };
  window.__AIHERO_ZH_DICTIONARY_CACHE__ = new Map();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.fetch = async () => ({
    ok: true,
    json: async () => ({
      exact: { [sourceTitle]: translatedTitle },
      blocks: {},
    }),
  });
  window.NodeFilter = { SHOW_TEXT: 4 };
  window.Element = window.HTMLElement || window.Element;

  vm.runInNewContext(runtimeSource, {
    window,
    document: window.document,
    location: window.location,
    URL,
    Element: window.Element,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    fetch: window.fetch,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    console,
  });
  await wait(60);

  const tooltip = window.document.createElement('span');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.setAttribute(
    'style',
    'position: fixed; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
  );
  tooltip.textContent = sourceTitle;
  window.document.body.append(tooltip);
  await wait(40);

  assert.equal(tooltip.textContent, translatedTitle);
  assert.equal(window.document.querySelector('#hidden').textContent, sourceTitle);
});
