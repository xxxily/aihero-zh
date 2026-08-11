import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'acorn';
import * as walk from 'acorn-walk';
import { VENDOR_ROOT } from '../src/config.mjs';

const repo = 'cfy2015/aihero-skills-zh';
const rawUrl = `https://raw.githubusercontent.com/${repo}/main/aihero-skills-zh.user.js`;
const licenseUrl = `https://raw.githubusercontent.com/${repo}/main/LICENSE`;
const targetDir = path.join(VENDOR_ROOT, repo.replace('/', '-'));

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'aihero-zh-maintainer/0.1' },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const extractObjectCounts = (source) => {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const counts = {};
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (!node.id?.name || !['TEXT', 'FRAG'].includes(node.id.name)) return;
      if (node.init?.type !== 'ObjectExpression') return;
      counts[node.id.name] = node.init.properties.filter((property) => property.type === 'Property').length;
    },
  });
  return counts;
};

await fs.mkdir(targetDir, { recursive: true });
const [source, license] = await Promise.all([fetchText(rawUrl), fetchText(licenseUrl)]);
await fs.writeFile(path.join(targetDir, 'aihero-skills-zh.user.js'), source);
await fs.writeFile(path.join(targetDir, 'LICENSE'), license);

let commit = null;
try {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'aihero-zh-maintainer/0.1' },
  });
  if (response.ok) commit = (await response.json()).sha;
} catch {
  // The raw file remains enough to pin content when the API is unavailable.
}

const lock = {
  schemaVersion: 1,
  repository: repo,
  rawUrl,
  fetchedAt: new Date().toISOString(),
  sourceHash: sha256(source),
  upstreamCommit: commit,
  license: 'MIT',
  translationCounts: extractObjectCounts(source),
};
await fs.writeFile(path.join(VENDOR_ROOT, 'vendor-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
console.log(JSON.stringify(lock, null, 2));
