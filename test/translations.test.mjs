import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTranslationsFor } from '../src/lib/translations.mjs';

test('loads route-scoped fragments and reviewed rich-text blocks', async () => {
  const model = await loadTranslationsFor('/ai-coding-dictionary/model');
  assert.equal(model.exact.The, '模型指的就是这些');
  assert.match(model.blocks['The parameters. Stateless — does next-token prediction and nothing else. "Claude Opus 4.x" and "GPT-5.x" are models. On its own a model can\'t do anything agentic; it has to be harnessed.'], /href="\/ai-coding-dictionary\/parameters"/);
});

test('does not leak route-scoped fragments into other pages', async () => {
  const attention = await loadTranslationsFor('/ai-coding-dictionary/attention-relationship');
  assert.equal(attention.exact[', the'], undefined);
});

test('loads route-scoped entries that are inserted dynamically after the snapshot', async () => {
  const ralph = await loadTranslationsFor('/tips-for-ai-coding-with-ralph-wiggum');
  const other = await loadTranslationsFor('/getting-started-with-ralph');
  assert.equal(ralph.exact['Go deeper'], '深入学习');
  assert.equal(other.exact['Go deeper'], undefined);
});
