import test from 'node:test';
import assert from 'node:assert/strict';
import { injectHtml, translateHtml } from '../src/lib/html.mjs';

test('injects translation runtime and rewrites same-origin links', () => {
  const html = '<html><head><title>Demo</title></head><body><a href="https://www.aihero.dev/skills">Skills</a></body></html>';
  const result = injectHtml(html, { pathname: '/', requestUrl: 'https://www.aihero.dev/' });
  assert.match(result, /navigation-runtime\.js/);
  assert.match(result, /translation-runtime\.js/);
  assert.match(result, /href="\/skills"/);
  assert.match(result, /data-aihero-zh/);
  assert.doesNotMatch(result, /cfy-skills\.user\.js/);
});

test('loads the community skills vendor on skills routes', () => {
  const result = injectHtml('<html><head></head><body></body></html>', {
    pathname: '/skills-to-spec',
    requestUrl: 'https://www.aihero.dev/skills-to-spec',
  });
  assert.match(result, /"skillsVendor":true/);
});

test('translates server-rendered text and Next hydration payload without touching code', () => {
  const payload = JSON.stringify('Start the free 7-day course');
  const html = '<html lang="en"><head><title>Become a Real AI Hero</title></head><body>'
    + '<h1>Engineering fundamentals aren\'t obsolete.</h1>'
    + `<script>self.__next_f.push([1,${JSON.stringify(payload)}]);</script>`
    + '<script>window.keep = "Engineering fundamentals aren\'t obsolete.";</script></body></html>';
  const result = translateHtml(html, {
    exact: {
      'Engineering fundamentals aren\'t obsolete.': '工程基础并没有过时。',
      'Start the free 7-day course': '开始免费的 7 天课程',
      'Become a Real AI Hero': '成为真正的 AI Hero',
    },
  });
  assert.match(result, /工程基础并没有过时。/);
  assert.match(result, /开始免费的 7 天课程/);
  assert.match(result, /window\.keep = "Engineering fundamentals aren.t obsolete\."/);
});

test('translates reviewed rich-text blocks inside article content on the server', () => {
  const source = 'The model uses parameters and keeps inline code.';
  const html = '<html><body><article><p>The model uses <a href="/ai-coding-dictionary/parameters">parameters</a> and keeps <code>inline code</code>.</p></article></body></html>';
  const result = translateHtml(html, {
    blocks: {
      [source]: '模型使用<a href="/ai-coding-dictionary/parameters">参数</a>，并保留 <code>inline code</code>。',
    },
  });
  assert.match(result, /模型使用<a href="\/ai-coding-dictionary\/parameters">参数<\/a>/);
  assert.match(result, /<code>inline code<\/code>/);
  assert.doesNotMatch(result, /The model uses/);
});

test('holds server-translated documents until hydration and translation settle', () => {
  const result = injectHtml('<html lang="en"><head></head><body><p>Hello</p></body></html>', {
    pathname: '/',
    requestUrl: 'https://www.aihero.dev/',
    dictionary: { exact: { Hello: '你好' } },
    serverTranslate: true,
  });
  assert.match(result, /data-aihero-zh-rendered="server"/);
  assert.match(result, /"serverRendered":true/);
  assert.match(result, /"paintSettleMs":120/);
  assert.match(result, /"paintTimeoutMs":2500/);
  assert.match(result, /<script src="\/__aihero\/translation-runtime\.js"><\/script>/);
  assert.match(result, />你好<\/p>/);
  assert.match(result, /data-aihero-zh-paint="pending"/);
  assert.match(result, /<style data-aihero-zh-paint>body\{visibility:hidden!important\}<\/style>/);
  assert.match(result, /<noscript><style>body\{visibility:visible!important\}<\/style><\/noscript>/);
  assert.doesNotMatch(result, /<script defer src="\/__aihero\/translation-runtime\.js">/);
});
