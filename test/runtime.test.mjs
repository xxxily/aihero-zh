import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const runtimeSource = await fs.readFile(new URL('../public/translation-runtime.js', import.meta.url), 'utf8');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
