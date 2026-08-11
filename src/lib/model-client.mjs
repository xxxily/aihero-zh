import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROJECT_ROOT } from '../config.mjs';

export const loadModelConfig = async (filePath = process.env.AIHERO_TRANSLATION_CONFIG) => {
  const resolved = filePath || path.join(PROJECT_ROOT, 'config/translation.json');
  return JSON.parse(await fs.readFile(resolved, 'utf8'));
};

const parseJsonResponse = (value) => {
  const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
};

export const translateBatch = async ({ items, mode = 'translate', config }) => {
  if (config.enabled === false) throw new Error('Model translation is disabled by config; enable it explicitly for later updates.');
  if (config.provider === 'ollama') {
    const system = [
      'You translate and edit content for a Chinese mirror of aihero.dev.',
      config.style,
      `Preserve these terms: ${(config.preserveTerms || []).join(', ')}.`,
      'Never translate shell commands, code, URLs, file paths, slash commands, package names, model identifiers, numbers, or placeholders.',
      mode === 'review' ? 'Review and correct the supplied Chinese translations.' : 'Translate each English source string into Simplified Chinese.',
      'Return JSON only: {"items":[{"id":"...","translation":"...","notes":"..."}]}. Keep every id exactly once and in order.',
    ].join('\n');
    const response = await fetch(`${String(config.baseUrl).replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: 'json',
        think: false,
        options: { temperature: config.temperature ?? 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ mode, items }) },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs || 300000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${JSON.stringify(payload)}`);
    return parseJsonResponse(payload.message?.content).items || [];
  }
  if (config.provider === 'claude-cli') {
    const prompt = [
      'Translate and edit content for a Chinese mirror of aihero.dev.',
      config.style,
      `Preserve these terms: ${(config.preserveTerms || []).join(', ')}.`,
      'Never translate shell commands, code, URLs, file paths, slash commands, package names, model identifiers, numbers, or placeholders.',
      mode === 'review' ? 'Review and correct the supplied Chinese translations.' : 'Translate each English source string into Simplified Chinese.',
      'Return JSON only: {"items":[{"id":"...","translation":"...","notes":"..."}]}. Keep every id exactly once and in order.',
      JSON.stringify({ mode, items }),
    ].join('\n');
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--bare',
      '--no-session-persistence',
    ];
    if (config.model && config.model !== 'default') args.push('--model', config.model);
    const { stdout, stderr, code } = await runProcess('claude', args, config.timeoutMs || 300000);
    if (code !== 0) throw new Error(`Claude CLI failed (${code}): ${stderr || stdout.slice(-2000)}`);
    const envelope = JSON.parse(stdout);
    if (envelope.is_error || envelope.api_error_status) {
      throw new Error(`Claude CLI API error (${envelope.api_error_status || 'unknown'}): ${envelope.result || 'unknown error'}`);
    }
    return parseJsonResponse(envelope.result).items || [];
  }
  if (config.provider === 'codex-cli') {
    const prompt = [
      'You are the translation and editorial review engine for a Chinese mirror of aihero.dev.',
      config.style,
      `Preserve these terms: ${(config.preserveTerms || []).join(', ')}.`,
      'Never translate shell commands, code, URLs, file paths, slash commands, package names, model identifiers, numbers, or placeholders.',
      mode === 'review'
        ? 'Review each existing Chinese translation against the English source and return a corrected translation.'
        : 'Translate each English source string into accurate, natural Simplified Chinese.',
      'Return JSON only with this exact shape: {"items":[{"id":"...","translation":"...","notes":"..."}]}. Keep every input id once and in order.',
      JSON.stringify({ mode, items }),
    ].join('\n');
    const { stdout, stderr, code } = await runProcess('codex', [
        'exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', prompt,
      ], config.timeoutMs || 300000);
    if (code !== 0) throw new Error(`Codex CLI failed (${code}): ${stderr}`);
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Codex CLI did not return JSON: ${stdout.slice(-1000)}`);
    return parseJsonResponse(jsonMatch[0]).items || [];
  }
  const apiKey = process.env[config.apiKeyEnv || 'OPENAI_API_KEY'];
  if (!apiKey) throw new Error(`Missing API key environment variable: ${config.apiKeyEnv || 'OPENAI_API_KEY'}`);
  const system = [
    'You are the translation and editorial review engine for a Chinese mirror of aihero.dev.',
    config.style,
    `Preserve these terms unless Chinese convention clearly requires otherwise: ${(config.preserveTerms || []).join(', ')}.`,
    'Never translate shell commands, code, URLs, file paths, slash commands, package names, model identifiers, numbers, or placeholders.',
    mode === 'review'
      ? 'Review each existing Chinese translation against the English source. Return a corrected translation only when it materially improves accuracy or fluency.'
      : 'Translate each English source string into accurate, natural Simplified Chinese.',
    'Return JSON only: {"items":[{"id":"...","translation":"...","notes":"..."}]}. Keep every input id exactly once and in the same order.',
  ].filter(Boolean).join('\n');
  const response = await fetch(`${String(config.baseUrl).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature ?? 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ mode, items }) },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs || 120000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Model request failed (${response.status}): ${JSON.stringify(payload)}`);
  return parseJsonResponse(payload.choices?.[0]?.message?.content).items || [];
};

const runProcess = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (signal) reject(new Error(`${command} terminated by ${signal}: ${stderr}`));
    else resolve({ stdout, stderr, code });
  });
  child.stdin.end();
});
