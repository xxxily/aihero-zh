import crypto from 'node:crypto';
import { parseHTML } from 'linkedom';

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'SVG',
  'CODE',
  'PRE',
  'TEXTAREA',
  'TITLE',
  'NOSCRIPT',
]);

export const normalizeText = (value) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const hash = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

export const isTechnicalText = (value) => {
  const text = normalizeText(value);
  if (!text || text.length < 2) return true;
  if (/^[\d.,+%\s-]+$/.test(text)) return true;
  if (/^\/?[a-z0-9][a-z0-9/_-]*$/.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return true;
  if (/^v\d(?:\.\d+)*$/i.test(text)) return true;
  if (/\.(md|xml|txt|sh)$/i.test(text)) return true;
  return false;
};

const isHidden = (element) =>
  element.hasAttribute?.('hidden') || element.getAttribute?.('aria-hidden') === 'true';

const hasSkippedAncestor = (element, root) => {
  for (let current = element; current && current !== root; current = current.parentElement) {
    if (SKIP_TAGS.has(current.tagName) || isHidden(current)) return true;
  }
  return false;
};

export const extractTextNodes = (html) => {
  const { document } = parseHTML(html);
  const values = [];
  const pushText = (node, value) => {
    if (!value || hasSkippedAncestor(node.parentElement, document.body)) return;
    const text = normalizeText(value);
    if (text && !isTechnicalText(text)) values.push(text);
  };
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 1 && (SKIP_TAGS.has(node.tagName) || isHidden(node))) return;
    if (node.nodeType === 3) {
      pushText(node, node.nodeValue);
      return;
    }
    let adjacentText = '';
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        adjacentText += child.nodeValue || '';
      } else {
        pushText(node, adjacentText);
        adjacentText = '';
        walk(child);
      }
    }
    pushText(node, adjacentText);
  };
  walk(document.body);
  return [...new Set(values)];
};

export const extractPageSnapshot = ({ html, sourceUrl, pathname }) => {
  const { document } = parseHTML(html);
  const strings = extractTextNodes(html);
  const title = normalizeText(document.title);
  const textPayload = strings.join('\n');
  return {
    schemaVersion: 1,
    sourceUrl,
    pathname,
    fetchedAt: new Date().toISOString(),
    title,
    contentHash: hash(html),
    textHash: hash(textPayload),
    strings: strings.map((text) => ({
      id: hash(`${pathname}\0${text}`),
      text,
      hash: hash(text),
    })),
  };
};

export const slugForPath = (pathname) => {
  if (pathname === '/') return 'index';
  return pathname
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/\//g, '__')
    .replace(/-+/g, '-')
    .slice(0, 180);
};
