import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const sourcePath = path.join(projectRoot, 'vendor/cfy2015-aihero-skills-zh/aihero-skills-zh.user.js');
const outputPath = path.join(projectRoot, 'content/translations/skills-vendor.json');
const source = await fs.readFile(sourcePath, 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const values = {};

const literalValue = (node) => {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'ObjectExpression') {
    const object = {};
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed) continue;
      const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
      const value = literalValue(property.value);
      if (typeof key === 'string' && typeof value === 'string') object[key] = value;
    }
    return object;
  }
  return undefined;
};

simple(ast, {
  VariableDeclarator(node) {
    if (node.id.type !== 'Identifier' || !['TEXT', 'FRAG'].includes(node.id.name)) return;
    values[node.id.name] = literalValue(node.init) || {};
  },
});

if (!values.TEXT || !values.FRAG) throw new Error('Could not extract TEXT/FRAG from vendor userscript');
// The vendor userscript calls TEXT/FRAG through exact lookup. Preserve that
// behavior in the server dictionary instead of treating FRAG as substring
// replacement, which could corrupt unrelated prose.
const exact = { ...values.TEXT, ...values.FRAG };
const contains = [];
const output = {
  schemaVersion: 1,
  source: 'cfy2015/aihero-skills-zh',
  sourceLock: JSON.parse(await fs.readFile(path.join(projectRoot, 'vendor/vendor-lock.json'), 'utf8')),
  reviewedAt: new Date().toISOString().slice(0, 10),
  exact,
  contains,
  counts: { exact: Object.keys(exact).length, contains: contains.length },
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`写入 ${outputPath}: ${output.counts.exact} 条精确译文，${output.counts.contains} 条片段译文`);
