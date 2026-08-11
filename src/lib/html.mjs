import {
  HYDRATION_DELAY_MS,
  PAINT_SETTLE_MS,
  PAINT_TIMEOUT_MS,
  COMMUNITY_REPOSITORY,
  isSkillsRoute,
  ORIGIN,
} from '../config.mjs';

const SAME_ORIGIN = /^https:\/\/(?:www\.)?aihero\.dev(?=\/|$)/i;

const rewriteSameOriginUrls = (html) =>
  html.replace(
    /\b(href|src|action)=(['"])https:\/\/(?:www\.)?aihero\.dev([^'"\\]*)\2/gi,
    (_match, attribute, quote, path) => `${attribute}=${quote}${path || '/'}${quote}`,
  );

const SKIP_TRANSLATION_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'CODE', 'PRE', 'SVG', 'TEXTAREA']);
const ENTITY_MAP = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
]);

const decodeEntities = (value) => value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity) => {
  if (entity[0] === '#') {
    const hex = entity[1].toLowerCase() === 'x';
    const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isNaN(number) ? full : String.fromCodePoint(number);
  }
  return ENTITY_MAP.get(entity.toLowerCase()) || full;
});

const escapeText = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#x27;');

const TOKEN_PATTERN = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
const VOID_TAGS = new Set(['META', 'LINK', 'IMG', 'INPUT', 'BR', 'HR', 'AREA', 'BASE', 'EMBED', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE']);
const BLOCK_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

const tagFromToken = (token) => token.match(/^<\/?\s*([a-z0-9-]+)/i)?.[1]?.toUpperCase() || null;

const plainTextFromTokens = (tokens) => {
  const stack = [];
  let result = '';
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('<')) {
      const tag = tagFromToken(token);
      if (!tag) continue;
      if (token.startsWith('</')) {
        const index = stack.lastIndexOf(tag);
        if (index >= 0) stack.splice(index, 1);
      } else if (!token.endsWith('/>') && !VOID_TAGS.has(tag)) {
        stack.push(tag);
      }
      continue;
    }
    if (!stack.some((tag) => BLOCK_SKIP_TAGS.has(tag))) result += decodeEntities(token);
  }
  return result.replace(/\s+/g, ' ').trim();
};

const closingIndexFor = (tokens, start, tag) => {
  let depth = 1;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('<') || token.startsWith('<!--')) continue;
    const tokenTag = tagFromToken(token);
    if (tokenTag !== tag) continue;
    if (token.startsWith('</')) {
      depth -= 1;
      if (depth === 0) return index;
    } else if (!token.endsWith('/>') && !VOID_TAGS.has(tokenTag)) {
      depth += 1;
    }
  }
  return -1;
};

const sanitizeRichText = (value) => String(value || '').replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (full, rawTag, attributes) => {
  const tag = rawTag.toUpperCase();
  if (!['A', 'EM', 'STRONG', 'CODE', 'BR'].includes(tag)) return '';
  if (full.startsWith('</')) return `</${tag.toLowerCase()}>`;
  if (tag === 'BR') return '<br>';
  if (tag !== 'A') return `<${tag.toLowerCase()}>`;
  const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
  if (!href.startsWith('/') || href.startsWith('//')) return '';
  return `<a href="${escapeText(href)}">`;
});

const translateRichTextBlocks = (html, dictionary) => {
  const blocks = dictionary?.blocks || {};
  if (!Object.keys(blocks).length) return html;
  const tokens = html.match(TOKEN_PATTERN) || [];
  const stack = [];
  let result = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tag = tagFromToken(token);
    const isOpening = Boolean(tag && token.startsWith('<') && !token.startsWith('</') && !token.startsWith('<!'));
    if (isOpening && BLOCK_TAGS.has(tag) && stack.includes('ARTICLE')) {
      const closingIndex = closingIndexFor(tokens, index, tag);
      if (closingIndex > index) {
        const source = plainTextFromTokens(tokens.slice(index + 1, closingIndex));
        const translation = blocks[source];
        if (translation) {
          result += `${token}${sanitizeRichText(translation)}${tokens[closingIndex]}`;
          index = closingIndex;
          continue;
        }
      }
    }
    result += token;
    if (tag && isOpening && !token.endsWith('/>') && !VOID_TAGS.has(tag)) stack.push(tag);
    else if (tag && token.startsWith('</')) {
      const stackIndex = stack.lastIndexOf(tag);
      if (stackIndex >= 0) stack.splice(stackIndex, 1);
    }
  }
  return result;
};

const translateTextChunk = (chunk, dictionary) => {
  const exact = dictionary?.exact || {};
  const contains = dictionary?.contains || [];
  const leading = chunk.match(/^\s*/)?.[0] || '';
  const trailing = chunk.match(/\s*$/)?.[0] || '';
  const core = decodeEntities(chunk.slice(leading.length, chunk.length - trailing.length || undefined))
    .replace(/\s+/g, ' ')
    .trim();
  if (!core || /[\u4e00-\u9fff]/.test(core)) return chunk;
  if (exact[core]) return `${leading}${escapeText(exact[core])}${trailing}`;
  const fragment = contains.find((entry) => core.includes(entry.from));
  if (!fragment) return chunk;
  return `${leading}${escapeText(core.replace(fragment.from, fragment.to))}${trailing}`;
};

const translateSerializedStrings = (script, dictionary) => {
  const exact = dictionary?.exact || {};
  const replacements = Object.entries(exact)
    .filter(([from, to]) => from && to && from !== to)
    .sort(([left], [right]) => right.length - left.length)
    .map(([from, to]) => [JSON.stringify(from), JSON.stringify(to)]);
  const translateFlightChunk = (full, prefix, literal, suffix) => {
    try {
      let decoded = JSON.parse(literal);
      for (const [from, to] of replacements) decoded = decoded.replaceAll(from, to);
      return `${prefix}${JSON.stringify(decoded)}${suffix}`;
    } catch {
      return full;
    }
  };
  return script.replace(
    /(\.push\(\[1,\s*)("(?:\\.|[^"\\])*?")(\s*\]\))/g,
    translateFlightChunk,
  );
};

/**
 * Translate visible server-rendered text before it reaches the browser. This
 * keeps the upstream DOM/CSS intact while eliminating the English flash and
 * the extra client-side dictionary round trip.
 */
export const translateHtml = (html, dictionary = {}) => {
  const translatedBlocks = translateRichTextBlocks(html, dictionary);
  const stack = [];
  let result = '';
  let lastIndex = 0;
  for (const match of translatedBlocks.matchAll(TOKEN_PATTERN)) {
    result += translatedBlocks.slice(lastIndex, match.index);
    const token = match[0];
    if (token.startsWith('<')) {
      result += token;
      const closing = token.match(/^<\/?\s*([a-z0-9-]+)/i);
      if (closing && !token.startsWith('<!--') && !token.startsWith('<!') && !token.endsWith('/>')) {
        const tag = closing[1].toUpperCase();
        if (token.startsWith('</')) stack.pop();
        else if (!['META', 'LINK', 'IMG', 'INPUT', 'BR', 'HR', 'AREA', 'BASE', 'EMBED', 'PARAM', 'SOURCE', 'TRACK', 'WBR'].includes(tag)) {
          stack.push({
            tag,
          });
        }
      }
    } else if (stack.at(-1)?.tag === 'SCRIPT' && dictionary?.translateSerialized !== false && /(?:__next_f|globalThis\.__UPLOADTHING|self\.__next_f)/.test(token)) {
      result += translateSerializedStrings(token, dictionary);
    } else if (!stack.some(({ tag }) => SKIP_TRANSLATION_TAGS.has(tag))) {
      result += translateTextChunk(token, dictionary);
    } else {
      result += token;
    }
    lastIndex = match.index + token.length;
  }
  result += translatedBlocks.slice(lastIndex);
  return result;
};

export const injectHtml = (html, { pathname, requestUrl, dictionary = {}, serverTranslate = false }) => {
  const context = JSON.stringify({
    route: pathname,
    source: requestUrl,
    origin: ORIGIN,
    repository: COMMUNITY_REPOSITORY,
    skillsVendor: isSkillsRoute(pathname),
    serverRendered: serverTranslate,
    hydrationDelayMs: HYDRATION_DELAY_MS,
    paintSettleMs: PAINT_SETTLE_MS,
    paintTimeoutMs: PAINT_TIMEOUT_MS,
  });
  const titleHtml = dictionary.title
    ? html.replace(/(<title\b[^>]*>)[\s\S]*?(<\/title>)/i, `$1${escapeText(dictionary.title)}$2`)
    : html;
  const injection = `\n<link rel="stylesheet" href="/__aihero/zh-overrides.css">\n<meta name="robots" content="noindex,nofollow">\n<meta name="aihero-zh-source" content="${ORIGIN}">\n<meta name="aihero-zh-rendered" content="${serverTranslate ? 'server' : 'hydration-safe'}">\n<style data-aihero-zh-paint>body{visibility:hidden!important}</style><noscript><style>body{visibility:visible!important}</style></noscript>\n<script>window.__AIHERO_ZH_CONTEXT__=${context};</script>\n<script src="/__aihero/navigation-runtime.js"></script>\n<script src="/__aihero/translation-runtime.js"></script>\n`;
  const withoutPrefetchHints = titleHtml.replace(/<link\b[^>]*\brel=(['"])(?:prefetch|prerender)\1[^>]*>/gi, '');
  const withoutAnalytics = withoutPrefetchHints
    .replace(/<link\b[^>]*href=(['"])(?:https?:)?\/\/(?:www\.)?googletagmanager\.com[^>]*>/gi, '')
    .replace(/<script\b[^>]*src=(['"])(?:https?:)?\/\/(?:www\.)?googletagmanager\.com[^>]*>[\s\S]*?<\/script>/gi, '');
  const translated = serverTranslate
    ? translateHtml(withoutAnalytics, { ...dictionary, translateSerialized: false })
    : withoutAnalytics;
  const marked = translated.replace(/<html\b([^>]*)>/i, (_full, attributes) => {
    const clean = attributes
      .replace(/\sdata-aihero-zh=(['"])[\s\S]*?\1/i, '')
      .replace(/\slang=(['"])[\s\S]*?\1/i, '');
    return `<html${clean} data-aihero-zh="true" data-aihero-zh-rendered="${serverTranslate ? 'server' : 'hydration-safe'}" data-aihero-zh-paint="pending">`;
  });
  const rewritten = rewriteSameOriginUrls(marked);
  if (/<\/head>/i.test(rewritten)) return rewritten.replace(/<\/head>/i, `${injection}</head>`);
  return `${rewritten}${injection}`;
};

export const isHtmlResponse = (response) =>
  (response.headers.get('content-type') || '').toLowerCase().includes('text/html');

export const isSameOriginUrl = (value) => SAME_ORIGIN.test(value);
