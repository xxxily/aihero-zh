import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const translateConfigArg = args.find((value) => value.startsWith('--translate-config='));
const translateConfigPath = translateConfigArg?.slice('--translate-config='.length) || 'config/translation.json';
const shouldTranslate = args.includes('--translate');
const checkOnly = args.includes('--check-only');
let translateConfig = null;
const run = (command, commandArgs) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, { stdio: 'inherit', shell: false });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} exited with ${code}`)));
});

if (shouldTranslate) {
  if (!translateConfigArg) {
    throw new Error('模型翻译需要显式提供 --translate-config=<file>；首次发布不得隐式调用模型。');
  }
  translateConfig = JSON.parse(await fs.readFile(translateConfigPath, 'utf8'));
  if (translateConfig.enabled !== true) {
    throw new Error(`模型翻译配置未启用：${translateConfigPath}。请明确设置 enabled=true 后再执行。`);
  }
}

await run('npm', ['run', 'check-updates']);
if (checkOnly) process.exit(0);
await run('npm', ['run', 'sync-pages', '--', '--all', '--concurrency=8']);
await run('npm', ['run', 'build-source']);
await run('npm', ['run', 'translation-rebuild-primary']);
if (shouldTranslate) {
  await run('npm', ['run', 'translate:memory', '--', `--config=${translateConfigPath}`]);
} else if (translateConfigArg) {
  console.log('已忽略 --translate-config：未提供 --translate，更新流程不会调用模型。');
}
await run('npm', ['run', 'build-translations']);
await run('npm', ['run', 'translation-quality']);
await run('npm', ['test']);
console.log('AI Hero 中文版更新流程完成。');
