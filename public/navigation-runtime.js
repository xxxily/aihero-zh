(function () {
  'use strict';

  const context = window.__AIHERO_ZH_CONTEXT__ || {};
  const root = () => document.documentElement;
  root().dataset.aiheroZh = 'true';
  const dictionaryCache = window.__AIHERO_ZH_DICTIONARY_CACHE__ ||= new Map();
  const sourceOrigin = (() => {
    try {
      return new URL(context.origin || '').origin;
    } catch {
      return '';
    }
  })();
  const normalizeRoute = (value) => {
    try {
      const url = new URL(value || location.href, location.href);
      return `${url.pathname}${url.search}`;
    } catch {
      return `${location.pathname}${location.search}`;
    }
  };

  let progress = null;
  let progressValue = 0;
  let advanceTimer = 0;
  let safetyTimer = 0;
  let pendingRoute = '';

  const mountProgress = () => {
    if (progress?.isConnected) return progress;
    progress = document.createElement('div');
    progress.setAttribute('data-aihero-route-progress', '');
    progress.setAttribute('aria-hidden', 'true');
    document.documentElement.append(progress);
    return progress;
  };

  const setProgress = (value) => {
    progressValue = Math.max(progressValue, Math.min(1, value));
    mountProgress().style.setProperty('--aihero-route-progress', String(progressValue));
  };

  const preloadDictionary = (route) => {
    if (!route) return null;
    const dictionaryRoute = (() => {
      try { return new URL(route, location.href).pathname; } catch { return location.pathname; }
    })();
    if (dictionaryCache.has(dictionaryRoute)) return dictionaryCache.get(dictionaryRoute);
    const request = fetch(`/__aihero/translations?path=${encodeURIComponent(dictionaryRoute)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`dictionary request failed: ${response.status}`);
        return response.json();
      })
      .catch((error) => {
        dictionaryCache.delete(dictionaryRoute);
        throw error;
      });
    dictionaryCache.set(dictionaryRoute, request);
    return request;
  };

  const start = (route, trigger) => {
    const nextRoute = normalizeRoute(route);
    if (nextRoute === normalizeRoute(location.href) && trigger === 'click') return;
    if (root().dataset.aiheroZhNavigation === 'pending' && pendingRoute === nextRoute) return;

    document.documentElement.dataset.aiheroZh = 'true';
    pendingRoute = nextRoute;
    progressValue = 0;
    root().dataset.aiheroZhNavigation = 'pending';
    root().setAttribute('aria-busy', 'true');
    try { sessionStorage.setItem('aihero-zh-navigation-pending', nextRoute); } catch {}
    setProgress(0.08);
    window.clearInterval(advanceTimer);
    advanceTimer = window.setInterval(() => {
      const remaining = 0.9 - progressValue;
      setProgress(progressValue + Math.max(0.015, remaining * 0.12));
    }, 180);
    window.clearTimeout(safetyTimer);
    safetyTimer = window.setTimeout(() => finish('timeout'), 8000);
    preloadDictionary(nextRoute)?.catch(() => {});
    window.dispatchEvent(new window.CustomEvent('aihero:navigation-start', {
      detail: { route: nextRoute, trigger },
    }));
  };

  const finish = (reason) => {
    if (root().dataset.aiheroZhNavigation !== 'pending') return;
    window.clearInterval(advanceTimer);
    window.clearTimeout(safetyTimer);
    setProgress(1);
    root().dataset.aiheroZhNavigation = 'complete';
    root().removeAttribute('aria-busy');
    try { sessionStorage.removeItem('aihero-zh-navigation-pending'); } catch {}
    pendingRoute = '';
    window.setTimeout(() => {
      root().removeAttribute('data-aihero-zh-navigation');
      progressValue = 0;
      if (progress) progress.style.removeProperty('--aihero-route-progress');
    }, 240);
    window.dispatchEvent(new window.CustomEvent('aihero:navigation-complete', {
      detail: { route: normalizeRoute(location.href), reason },
    }));
  };

  const notifyRouteChange = (trigger) => {
    const route = normalizeRoute(location.href);
    start(route, trigger);
    window.dispatchEvent(new window.CustomEvent('aihero:route-change', {
      detail: { route, trigger },
    }));
  };

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      const before = normalizeRoute(location.href);
      const result = original(...args);
      if (normalizeRoute(location.href) !== before) notifyRouteChange(method);
      return result;
    };
  }

  window.addEventListener('popstate', () => notifyRouteChange('popstate'));
  window.addEventListener('aihero:translation-ready', (event) => {
    const readyRoute = normalizeRoute(event.detail?.route || location.href);
    if (pendingRoute && readyRoute !== pendingRoute) return;
    if (pendingRoute && normalizeRoute(location.href) !== pendingRoute) return;
    finish('translation-ready');
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target || target.hasAttribute('download') || target.target === '_blank') return;

    let destination;
    try {
      destination = new URL(target.href, location.href);
    } catch {
      return;
    }
    if (destination.origin === sourceOrigin) {
      const localHref = `${destination.pathname}${destination.search}${destination.hash}`;
      target.setAttribute('href', localHref);
      destination = new URL(localHref, location.href);
    }
    if (destination.origin !== location.origin) return;
    const current = `${location.pathname}${location.search}${location.hash}`;
    const next = `${destination.pathname}${destination.search}${destination.hash}`;
    if (current === next) return;
    start(`${destination.pathname}${destination.search}`, 'click');
  }, true);

  try {
    const pending = sessionStorage.getItem('aihero-zh-navigation-pending');
    if (pending) start(pending, 'document-load');
  } catch {}

  window.__AIHERO_ZH_NAVIGATION__ = {
    start,
    finish,
    preloadDictionary,
    normalizeRoute,
  };
})();
