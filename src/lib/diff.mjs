import { distance } from 'fastest-levenshtein';

const similarity = (left, right) => {
  const size = Math.max(left.length, right.length);
  if (!size) return 1;
  return 1 - distance(left, right) / size;
};

export const diffStrings = (previous = [], current = []) => {
  const oldByText = new Map(previous.map((entry) => [entry.text, entry]));
  const newByText = new Map(current.map((entry) => [entry.text, entry]));
  const added = current.filter((entry) => !oldByText.has(entry.text));
  const removed = previous.filter((entry) => !newByText.has(entry.text));
  const changed = [];
  const consumedOld = new Set();
  const consumedNew = new Set();

  for (const next of added) {
    let best = null;
    for (const old of removed) {
      if (consumedOld.has(old.text)) continue;
      const score = similarity(old.text, next.text);
      if (!best || score > best.score) best = { old, next, score };
    }
    if (best && best.score >= 0.68) {
      changed.push({
        before: best.old,
        after: best.next,
        similarity: Number(best.score.toFixed(3)),
      });
      consumedOld.add(best.old.text);
      consumedNew.add(best.next.text);
    }
  }

  return {
    added: added.filter((entry) => !consumedNew.has(entry.text)),
    removed: removed.filter((entry) => !consumedOld.has(entry.text)),
    changed,
    unchanged: current.filter((entry) => oldByText.has(entry.text)),
  };
};

export const coverageFor = (snapshot, translations = {}) => {
  const translated = new Set(Object.keys(translations));
  const allowlist = new Set([
    'AI', 'Hero', 'GitHub', 'Claude Code', 'Codex', 'Cursor', 'Amp', 'Copilot',
    'Matt Pocock', 'Guillermo Rauch', 'Mario Zechner', 'shadcn',
  ]);
  const reviewable = snapshot.strings.filter((entry) =>
    !/^\/?[a-z0-9][a-z0-9/_-]*$/.test(entry.text) && !allowlist.has(entry.text),
  );
  const covered = reviewable.filter((entry) => translated.has(entry.text));
  return {
    total: reviewable.length,
    covered: covered.length,
    missing: reviewable.length - covered.length,
    percentage: reviewable.length ? Math.round((covered.length / reviewable.length) * 100) : 100,
  };
};
