// ==UserScript==
// @name         FilterGram
// @namespace    https://github.com/joshm858/filtergram
// @version      0.1.0
// @description  Removes Reels, Explore and suggested posts from Instagram on the web. Reels sent to you still open, but can't be swiped to the next one.
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__filtergram) return;
  window.__filtergram = true;

  // ---------------------------------------------------------------- settings

  const STORE_KEY = 'filtergram:settings:v1';
  const OPTIONS = [
    ['reelsTab', 'Hide Reels tab and profile Reels tabs'],
    ['feedReels', 'Hide Reels posts in the home feed'],
    ['reelsFeed', 'Block the Reels feed (redirect home)'],
    ['lockReel', 'Lock single reels (no swiping to the next)'],
    ['explore', 'Hide Explore tab and page'],
    ['suggested', 'Hide suggested posts in the feed'],
  ];
  const DEFAULTS = Object.fromEntries(OPTIONS.map(([key]) => [key, true]));

  let settings = loadSettings();

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      /* private mode / storage blocked: settings just won't persist */
    }
  }

  // ------------------------------------------------------------------- paths

  // A specific reel: /reel/ID/, /reels/ID/ or /username/reel/ID/
  const REEL_PERMALINK = /^\/(?:[\w.]+\/)?reels?\/([\w-]+)\/?$/;
  // The endless Reels feed: /reels/ or /reels/audio/...
  const REELS_FEED = /^\/reels\/?$|^\/reels\/audio\//;
  // A profile's Reels tab: /username/reels/
  const PROFILE_REELS_TAB = /^\/([\w.]+)\/reels\/?$/;
  const EXPLORE_HOME = /^\/explore\/?$/;
  const HOME = /^\/(?:following\/?)?$/;

  const reelId = (path) => {
    if (REELS_FEED.test(path)) return null;
    const m = path.match(REEL_PERMALINK);
    return m ? m[1] : null;
  };

  // ----------------------------------------------------------------- styling

  const HIDDEN = 'data-fg-hidden';
  const LOCK_CLASS = 'fg-reel-lock';
  // At document-start the root element may not exist yet in some engines.
  const html = () => document.documentElement;

  const style = document.createElement('style');
  style.textContent = `
    [${HIDDEN}] { display: none !important; }
    html.${LOCK_CLASS}, html.${LOCK_CLASS} body { overflow: hidden !important; overscroll-behavior: none !important; }
    html.${LOCK_CLASS} main, html.${LOCK_CLASS} main * { scroll-snap-type: none !important; }
  `;

  // ------------------------------------------------------------ hiding rules

  function hide(el) {
    if (el) el.setAttribute(HIDDEN, '');
  }

  // Hide an anchor plus any wrapper that exists only to hold it (so the nav
  // bar doesn't keep an empty slot). Stops at a few levels or a landmark.
  function hideLinkSlot(anchor) {
    let el = anchor;
    for (let depth = 0; depth < 3; depth++) {
      const parent = el.parentElement;
      if (!parent || parent.children.length !== 1) break;
      if (['NAV', 'BODY', 'MAIN', 'HEADER', 'SECTION'].includes(parent.tagName)) break;
      el = parent;
    }
    hide(el);
  }

  function clearHidden() {
    document.querySelectorAll(`[${HIDDEN}]`).forEach((el) => el.removeAttribute(HIDDEN));
  }

  function applyHiding() {
    const path = location.pathname;

    if (settings.reelsTab) {
      document.querySelectorAll('a[href="/reels/"], a[href$="/reels/"]').forEach(hideLinkSlot);
    }
    if (settings.explore) {
      document.querySelectorAll('a[href="/explore/"]').forEach(hideLinkSlot);
    }

    if (HOME.test(path)) {
      document.querySelectorAll('article').forEach((article) => {
        if (article.hasAttribute(HIDDEN)) return;
        if (settings.feedReels && article.querySelector('a[href*="/reel/"], a[href*="/reels/"]')) {
          hide(article);
        } else if (
          settings.suggested &&
          /suggested (for you|post)/i.test((article.textContent || '').slice(0, 300))
        ) {
          hide(article);
        }
      });
    }
  }

  // --------------------------------------------------------------- redirects

  // Returns true if it started a redirect.
  function applyRedirects() {
    const path = location.pathname;
    let target = null;

    if (settings.reelsFeed) {
      if (REELS_FEED.test(path)) target = '/';
      const tab = path.match(PROFILE_REELS_TAB);
      if (tab && tab[1] !== 'reels') target = `/${tab[1]}/`;
    }
    if (settings.explore && EXPLORE_HOME.test(path)) target = '/';

    if (target) {
      location.replace(target);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------- reel lock

  // Single reels (from DMs, profiles) are allowed but must not advance. We
  // block scroll gestures, and as a fallback bounce back if the URL moves on
  // to a different reel anyway.
  let anchor = null;

  const lockActive = () => !!html() && html().classList.contains(LOCK_CLASS);

  function trackReel() {
    const id = settings.lockReel ? reelId(location.pathname) : null;
    if (!id) {
      anchor = null;
      html().classList.remove(LOCK_CLASS);
      return;
    }
    if (!anchor) {
      anchor = { id, url: location.pathname + location.search };
    } else if (anchor.id !== id) {
      location.replace(anchor.url);
      return;
    }
    html().classList.add(LOCK_CLASS);
  }

  const EXEMPT = '[role="dialog"], [role="slider"], input, textarea, [contenteditable="true"], [role="textbox"]';
  const exempt = (target) => !!(target && target.closest && target.closest(EXEMPT));

  function blockGesture(event) {
    if (!lockActive() || exempt(event.target)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }

  const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'j', 'k']);

  window.addEventListener('wheel', blockGesture, { passive: false, capture: true });
  window.addEventListener('touchmove', blockGesture, { passive: false, capture: true });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!lockActive() || exempt(event.target) || !SCROLL_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // -------------------------------------------------------------- run loop

  let scheduled = false;

  function run() {
    scheduled = false;
    if (applyRedirects()) return;
    trackReel();
    applyHiding();
    ensurePanel();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  }

  // Instagram is a single-page app: watch history changes and DOM updates.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      schedule();
      return result;
    };
  }
  window.addEventListener('popstate', schedule);

  function boot() {
    html().appendChild(style);
    new MutationObserver(schedule).observe(html(), { childList: true, subtree: true });
    if (!applyRedirects()) trackReel();
    document.addEventListener('DOMContentLoaded', schedule);
  }

  if (html()) {
    boot();
  } else {
    const waiter = new MutationObserver(() => {
      if (!html()) return;
      waiter.disconnect();
      boot();
    });
    waiter.observe(document, { childList: true });
  }

  // ---------------------------------------------------------- settings panel

  let panelHost = null;

  function ensurePanel() {
    if (!document.body) return;
    if (panelHost) {
      if (!panelHost.isConnected) document.body.appendChild(panelHost);
      return;
    }

    panelHost = document.createElement('div');
    panelHost.id = 'fg-root';
    const shadow = panelHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
        .fab { position: fixed; left: 10px; bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
               width: 34px; height: 34px; border-radius: 50%; border: 0; z-index: 2147483647;
               background: #1f2937; color: #fff; font-size: 12px; font-weight: 700; opacity: .55; }
        .fab:active, .fab[aria-expanded="true"] { opacity: 1; }
        .panel { position: fixed; left: 10px; bottom: calc(env(safe-area-inset-bottom, 0px) + 114px);
                 width: min(320px, calc(100vw - 20px)); z-index: 2147483647; padding: 14px;
                 border-radius: 14px; background: #fff; color: #111; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
        .panel[hidden] { display: none; }
        h2 { margin: 0 0 8px; font-size: 15px; }
        label { display: flex; gap: 10px; align-items: center; padding: 8px 0; font-size: 14px; }
        input { width: 20px; height: 20px; flex: none; }
        small { display: block; margin-top: 6px; color: #666; font-size: 12px; }
        @media (prefers-color-scheme: dark) {
          .panel { background: #1c1c1e; color: #f2f2f7; } small { color: #9a9aa0; }
        }
      </style>
      <button class="fab" aria-label="FilterGram settings" aria-expanded="false">FG</button>
      <div class="panel" hidden>
        <h2>FilterGram</h2>
        ${OPTIONS.map(([key, label]) => `<label><input type="checkbox" data-key="${key}"> ${label}</label>`).join('')}
        <small>Changes apply immediately. Runs on your device only.</small>
      </div>`;

    const fab = shadow.querySelector('.fab');
    const panel = shadow.querySelector('.panel');
    fab.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', String(open));
    });
    shadow.querySelectorAll('input[data-key]').forEach((input) => {
      input.checked = settings[input.dataset.key];
      input.addEventListener('change', () => {
        settings[input.dataset.key] = input.checked;
        saveSettings();
        clearHidden();
        run();
      });
    });

    document.body.appendChild(panelHost);
  }
})();
