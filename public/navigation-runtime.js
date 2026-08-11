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
  const communityRepository = (() => {
    try {
      return new URL(context.repository || 'https://github.com/xxxily/aihero-zh').toString();
    } catch {
      return 'https://github.com/xxxily/aihero-zh';
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
  let communityHeader = null;
  let communityTop = null;
  let communityFooter = null;
  let communityMountTimer = 0;

  const isConnected = (element) => Boolean(
    element && (element.isConnected || document.documentElement.contains(element)),
  );

  const sourceHref = () => {
    try {
      const source = new URL(context.origin || 'https://www.aihero.dev');
      const current = new URL(location.href);
      return `${source.origin}${current.pathname}${current.search}${current.hash}`;
    } catch {
      return 'https://www.aihero.dev/';
    }
  };

  const makeCommunityLink = (href, label, { source = false } = {}) => {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    if (source) link.setAttribute('data-aihero-source-link', '');
    return link;
  };

  const updateSourceLinks = () => {
    const href = sourceHref();
    for (const link of document.querySelectorAll('[data-aihero-source-link]')) link.href = href;
  };

  const mountCommunityHeader = () => {
    const header = [...document.querySelectorAll('header')]
      .find((element) => element.querySelector('a[aria-label="AI Hero home"]'));
    if (!header) return false;
    let group = header.querySelector('[data-aihero-community-links]');
    if (!group) {
      group = document.createElement('nav');
      group.setAttribute('aria-label', '社区链接');
      group.setAttribute('data-aihero-community-links', '');
      group.setAttribute('data-aihero-translation-ignore', '');
      const separator = document.createElement('span');
      separator.textContent = '·';
      separator.setAttribute('aria-hidden', 'true');
      group.append(
        makeCommunityLink(communityRepository, 'GitHub'),
        separator,
        makeCommunityLink(sourceHref(), '原站', { source: true }),
      );
      const userNavigation = header.querySelector('nav[aria-label="User navigation"]');
      if (userNavigation?.parentElement === header) header.insertBefore(group, userNavigation);
      else header.append(group);
    }
    header.setAttribute('data-aihero-community-header', '');
    communityHeader = group;
    return true;
  };

  const mountCommunityTop = () => {
    const announcement = document.querySelector('aside[aria-label="Announcement"]');
    if (!announcement) return false;
    let group = announcement.querySelector('[data-aihero-community-top-links]');
    if (!group) {
      group = document.createElement('nav');
      group.setAttribute('aria-label', '社区链接');
      group.setAttribute('data-aihero-community-top-links', '');
      group.setAttribute('data-aihero-translation-ignore', '');
      group.append(
        makeCommunityLink(communityRepository, 'GitHub'),
        makeCommunityLink(sourceHref(), '原站', { source: true }),
      );
      announcement.append(group);
    }
    communityTop = group;
    return true;
  };

  const mountCommunityFooter = () => {
    const footer = document.querySelector('footer');
    if (!footer) return false;
    let notice = footer.querySelector('[data-aihero-community-notice]');
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('data-aihero-community-notice', '');
      notice.setAttribute('data-aihero-translation-ignore', '');
      const copy = document.createElement('p');
      copy.textContent = '本站为 aihero.dev 中文社区翻译，非官方项目；页面结构与原文版权归原站及相关权利人所有。';
      const links = document.createElement('nav');
      links.setAttribute('aria-label', '社区项目链接');
      links.append(
        makeCommunityLink(communityRepository, 'GitHub'),
        makeCommunityLink(sourceHref(), '访问原站', { source: true }),
      );
      notice.append(copy, links);
      footer.append(notice);
    }
    communityFooter = notice;
    return true;
  };

  const mountCommunityChrome = () => {
    const headerMounted = mountCommunityHeader();
    const topMounted = mountCommunityTop();
    const footerMounted = mountCommunityFooter();
    updateSourceLinks();
    return headerMounted || topMounted || footerMounted;
  };

  const scheduleCommunityMount = () => {
    if (communityMountTimer) return;
    communityMountTimer = window.setTimeout(() => {
      communityMountTimer = 0;
      mountCommunityChrome();
    }, 0);
  };

  const startCommunityChrome = () => {
    scheduleCommunityMount();
    const observer = new MutationObserver(() => {
      const headerExists = document.querySelector('header a[aria-label="AI Hero home"]');
      const announcementExists = document.querySelector('aside[aria-label="Announcement"]');
      const footerExists = document.querySelector('footer');
      if (
        (headerExists && !isConnected(communityHeader))
        || (announcementExists && !isConnected(communityTop))
        || (footerExists && !isConnected(communityFooter))
      ) {
        scheduleCommunityMount();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  };

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
    scheduleCommunityMount();
    updateSourceLinks();
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
    mountCommunityChrome,
    preloadDictionary,
    normalizeRoute,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCommunityChrome, { once: true });
  else startCommunityChrome();
})();
