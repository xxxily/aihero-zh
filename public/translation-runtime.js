(function () {
  'use strict';

  const context = window.__AIHERO_ZH_CONTEXT__ || { route: location.pathname };
  const dictionaryCache = window.__AIHERO_ZH_DICTIONARY_CACHE__ ||= new Map();
  const fallbackHref = `http://aihero.local${context.route || '/'}`;
  const currentHref = () => typeof location !== 'undefined' && location?.href
    ? location.href
    : fallbackHref;
  const routeFor = (value = currentHref()) => {
    try {
      return new URL(value, currentHref()).pathname;
    } catch {
      return new URL(fallbackHref).pathname;
    }
  };
  const skipTags = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'CODE', 'PRE', 'SVG', 'TEXTAREA', 'TITLE', 'NOSCRIPT',
  ]);
  const hasCjk = (value) => /[\u4e00-\u9fff]/.test(value);
  const trim = (value) => value.replace(/\s+/g, ' ').trim();
  const intentionalEnglish = new Set([
    'AI', 'LLM', 'MCP', 'Token', 'TypeScript', 'Next.js',
    'sitemap.md', 'llms.txt', 'skills.md', 'rss.xml',
  ]);
  const translatableAttributes = ['placeholder', 'aria-label', 'title', 'alt'];
  const translatableAttributeSelector = translatableAttributes
    .map((name) => `[${name}]`)
    .join(',');
  const serverRendered = context.serverRendered === true
    || document.documentElement.dataset.aiheroZhRendered === 'server'
    || document.querySelector('meta[name="aihero-zh-rendered"]')?.content === 'server';
  document.documentElement.dataset.aiheroZh = 'true';
  document.documentElement.dataset.aiheroZhPaint = 'pending';

  const asNonNegativeNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
  };
  const paintSettleMs = asNonNegativeNumber(context.paintSettleMs, 120);
  const paintTimeoutMs = Math.max(
    paintSettleMs,
    asNonNegativeNumber(context.paintTimeoutMs, 2500),
  );
  let paintRevealed = false;
  let settleTimer = 0;
  let safetyTimer = 0;

  const reveal = () => {
    if (paintRevealed) return;
    paintRevealed = true;
    window.clearTimeout(settleTimer);
    window.clearTimeout(safetyTimer);
    document.documentElement.dataset.aiheroZhPaint = 'ready';
    document.querySelector('style[data-aihero-zh-paint]')?.remove();
  };

  // The upstream sidebar renders an overflow label as a fixed, pointer-free
  // span with aria-hidden="true". It is hidden from assistive technology, but
  // it is still visible to sighted users and must receive the same translation
  // as the truncated link underneath it.
  const isVisibleOverflowTooltip = (element) => {
    const style = element.style;
    return element.tagName === 'SPAN'
      && element.getAttribute('aria-hidden') === 'true'
      && style?.position === 'fixed'
      && style?.pointerEvents === 'none'
      && style?.whiteSpace === 'nowrap'
      && style?.textOverflow === 'ellipsis';
  };

  const shouldSkip = (node) => {
    const parent = node.parentElement;
    if (!parent) return true;
    let insideVisibleOverflowTooltip = false;
    for (let element = parent; element && element !== document.body; element = element.parentElement) {
      insideVisibleOverflowTooltip ||= isVisibleOverflowTooltip(element);
      if (
        skipTags.has(element.tagName)
        || element.hidden
        || (element.getAttribute('aria-hidden') === 'true' && !insideVisibleOverflowTooltip)
      ) {
        return true;
      }
    }
    return false;
  };

  const setTextPreservingWhitespace = (node, translated) => {
    const value = node.nodeValue || '';
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    // English snapshots often put spaces around inline links. Once the link
    // and its surrounding copy are Chinese, retaining those boundary spaces
    // makes prose read like "模型 参数". Chinese translations carry their
    // own punctuation/word boundaries, so trim only the outer whitespace.
    node.nodeValue = hasCjk(translated) ? translated : `${leading}${translated}${trailing}`;
    node.parentElement?.setAttribute('data-aihero-translated', 'true');
  };

  let dictionary = null;
  let dictionaryRoute = '';

  const sanitizedBlock = (html) => {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    for (const element of [...template.content.querySelectorAll('*')]) {
      if (!['A', 'EM', 'STRONG', 'CODE', 'BR'].includes(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ''));
        continue;
      }
      if (element.tagName === 'A') {
        const href = element.getAttribute('href') || '';
        if (!href.startsWith('/') || href.startsWith('//')) {
          element.replaceWith(document.createTextNode(element.textContent || ''));
          continue;
        }
        for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
        element.setAttribute('href', href);
        element.setAttribute('class', 'ah-prose-a');
      } else {
        for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
        if (element.tagName === 'EM') element.setAttribute('class', 'ah-prose-em');
      }
    }
    return template.content;
  };

  const applyBlocks = (currentDictionary) => {
    const blocks = currentDictionary.blocks || {};
    let translated = 0;
    for (const element of document.querySelectorAll('article p, article li, article blockquote')) {
      if (element.hasAttribute('data-aihero-translated-block')) continue;
      const source = trim(element.textContent || '');
      if (!blocks[source]) continue;
      element.replaceChildren(sanitizedBlock(blocks[source]));
      element.setAttribute('data-aihero-translated-block', 'true');
      translated += 1;
    }
    return translated;
  };

  const applyExactElements = (currentDictionary) => {
    const exact = currentDictionary.exact || {};
    let translated = 0;
    for (const element of document.querySelectorAll('h1, h2, h3, h4, h5, h6, th, td')) {
      if (element.childElementCount > 0) continue;
      const source = trim(element.textContent || '');
      const translation = exact[source];
      if (!source || hasCjk(source) || !translation || translation === source) continue;
      element.replaceChildren(document.createTextNode(translation));
      element.setAttribute('data-aihero-translated', 'true');
      translated += 1;
    }
    return translated;
  };

  const applyExactAttributes = (currentDictionary) => {
    const exact = currentDictionary.exact || {};
    let translated = 0;
    for (const element of document.querySelectorAll(translatableAttributeSelector)) {
      for (const attribute of translatableAttributes) {
        if (!element.hasAttribute(attribute)) continue;
        const source = trim(element.getAttribute(attribute) || '');
        if (!source || hasCjk(source) || !Object.prototype.hasOwnProperty.call(exact, source)) continue;
        const translation = exact[source];
        if (!translation || translation === source) continue;
        element.setAttribute(attribute, translation);
        translated += 1;
      }
    }
    return translated;
  };

  const apply = (currentDictionary) => {
    const exact = currentDictionary.exact || {};
    const contains = currentDictionary.contains || [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let translated = applyBlocks(currentDictionary)
      + applyExactElements(currentDictionary)
      + applyExactAttributes(currentDictionary);
    const untranslated = new Set();

    while ((node = walker.nextNode())) {
      if (shouldSkip(node)) continue;
      const core = trim(node.nodeValue || '');
      if (!core || hasCjk(core)) continue;
      if (Object.prototype.hasOwnProperty.call(exact, core)) {
        if (exact[core] !== core) {
          setTextPreservingWhitespace(node, exact[core]);
          translated += 1;
        }
        continue;
      }
      const fragment = contains.find((entry) => core.includes(entry.from));
      if (fragment) {
        setTextPreservingWhitespace(node, core.replace(fragment.from, fragment.to));
        translated += 1;
        continue;
      }
      if (/[A-Za-z]{3,}/.test(core) && !/^https?:\/\//.test(core) && !intentionalEnglish.has(core)) {
        untranslated.add(core);
      }
    }

    if (currentDictionary.title && document.title === currentDictionary.sourceTitle) {
      document.title = currentDictionary.title;
    } else if (currentDictionary.title && exact[document.title]) {
      document.title = currentDictionary.title;
    }
    document.documentElement.dataset.aiheroZh = 'true';
    document.documentElement.lang = 'zh-CN';
    document.documentElement.dataset.aiheroZhCoverage = `${translated}/${translated + untranslated.size}`;
    if (untranslated.size) {
      console.info(`[aihero-zh] ${untranslated.size} 条可见文本尚未有审校译文`, [...untranslated].slice(0, 12));
    }
  };

  const loadDictionary = async (route) => {
    let cached = dictionaryCache.get(route);
    if (!cached) {
      cached = fetch(`/__aihero/translations?path=${encodeURIComponent(route)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`dictionary request failed: ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          dictionaryCache.delete(route);
          throw error;
        });
      dictionaryCache.set(route, cached);
    }
    return await cached;
  };

  const run = async () => {
    try {
      const route = routeFor();
      const currentDictionary = dictionaryRoute === route && dictionary
        ? dictionary
        : await loadDictionary(route);
      // A slow dictionary request from the previous page must never translate
      // the newly-mounted route with stale, route-scoped entries.
      if (routeFor() !== route) return false;
      dictionary = currentDictionary;
      dictionaryRoute = route;
      apply(currentDictionary);
      document.documentElement.dataset.aiheroZhReady = 'true';
      document.documentElement.dataset.aiheroZhRoute = route;
      return true;
    } catch (error) {
      console.warn('[aihero-zh] 翻译覆盖层加载失败', error);
      reveal();
      return false;
    }
  };

  let pending = false;
  let rerunRequested = false;
  const queueReady = () => {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(async () => {
      const translated = await run();
      if (!translated) return;
      // Wait through one complete paint boundary so React cannot reveal an
      // English intermediate state between two hydration commits. The same
      // signal closes the route progress bar after client-side navigation.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!paintRevealed) reveal();
        window.dispatchEvent(new window.CustomEvent('aihero:translation-ready', {
          detail: { route: routeFor() },
        }));
      }));
    }, paintSettleMs);
  };

  const schedule = () => {
    window.clearTimeout(settleTimer);
    // Hydration can replace English text while an earlier translation pass is
    // still awaiting its dictionary/apply promise. Do not drop that mutation:
    // remember it and run again after the in-flight pass finishes.
    rerunRequested = true;
    if (pending) return;
    pending = true;
    (async () => {
      let translated = false;
      do {
        rerunRequested = false;
        translated = await run();
      } while (rerunRequested);
      pending = false;
      if (translated) queueReady();
    })();
  };

  window.addEventListener('aihero:route-change', (event) => {
    const nextRoute = routeFor(event.detail?.route || location.href);
    if (dictionaryRoute !== nextRoute) {
      dictionary = null;
      dictionaryRoute = '';
    }
    document.documentElement.dataset.aiheroZhReady = 'pending';
    schedule();
  });

  const observer = new MutationObserver(schedule);
  const start = () => {
    if (safetyTimer) return;
    const delay = serverRendered ? 0 : asNonNegativeNumber(context.hydrationDelayMs, 3000);
    const timeout = Math.max(paintTimeoutMs, delay + paintSettleMs + 1000);
    safetyTimer = window.setTimeout(() => {
      console.warn('[aihero-zh] 首屏翻译超时，解除隐藏门控');
      reveal();
    }, timeout);
    // Observe the Document rather than the current <html> node. Next.js can
    // replace root nodes during recovery hydration; a Document observer keeps
    // receiving later title/body writes and translates them before paint.
    observer.observe(document, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttributes,
      subtree: true,
    });
    const runAndQueueReady = async () => {
      const translated = await run();
      if (translated) queueReady();
    };
    window.setTimeout(runAndQueueReady, delay);

    // Run once more after load as a cheap recovery pass for client components
    // that mount at the very end of hydration. The MutationObserver handles
    // normal incremental updates.
    window.addEventListener('load', () => {
      window.setTimeout(runAndQueueReady, 0);
    }, { once: true });
  };

  if (document.readyState !== 'loading') start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
})();
