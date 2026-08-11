import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPageSnapshot, extractTextNodes, normalizeText } from '../src/lib/source.mjs';

test('normalizes visible text and skips executable/code content', () => {
  const html = '<html><head><title>Demo</title></head><body><h1>  Hello\n world </h1><script>bad()</script><pre>do not translate</pre><p hidden>hidden</p><p>Visible</p></body></html>';
  assert.deepEqual(extractTextNodes(html), ['Hello world', 'Visible']);
  assert.equal(normalizeText(' A\n\tB '), 'A B');
});

test('creates stable source ids from route and source text', () => {
  const snapshot = extractPageSnapshot({
    html: '<html><head><title>Demo</title></head><body><h1>Hello</h1></body></html>',
    sourceUrl: 'https://example.test/',
    pathname: '/',
  });
  assert.equal(snapshot.title, 'Demo');
  assert.equal(snapshot.strings[0].text, 'Hello');
  assert.equal(snapshot.strings[0].id.length, 64);
});
