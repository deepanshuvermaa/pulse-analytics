/*!
 * Pulse Analytics tracker
 *
 * Deliberately readable. The previous build was hex-obfuscated, which fooled no
 * ad-blocker, made every customer bug report unactionable, and looked like
 * malware to anyone reviewing what they were putting on their site.
 *
 * Install:
 *   <script defer src="https://your-host/t.js" data-id="PROJECT_ID"></script>
 *
 * Optional attributes:
 *   data-identity="persistent"  keep a durable id in localStorage (needs consent)
 *   data-autocapture="false"    stop recording clicks on interactive elements
 *   data-track-localhost="true" collect from localhost during development
 *   data-exclude="/admin/*,/preview/*"
 *   data-api="https://analytics.yoursite.com"   custom collector origin (CNAME proxy)
 *
 * API:
 *   pulse('event', 'signup_completed', { plan: 'pro' })
 *   pulse('identify', 'user_123')
 *   pulse('pageview')
 *   pulse('opt_out') / pulse('opt_in')
 */
(function (window, document) {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var PROJECT_ID = script.getAttribute('data-id');
  if (!PROJECT_ID) return;

  var API = (script.getAttribute('data-api') || script.src.replace(/\/t\.js.*$/, '')) + '/api/collect';
  var PERSISTENT = script.getAttribute('data-identity') === 'persistent';
  var AUTOCAPTURE = script.getAttribute('data-autocapture') !== 'false';
  var TRACK_LOCALHOST = script.getAttribute('data-track-localhost') === 'true';
  var EXCLUDES = (script.getAttribute('data-exclude') || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);

  var OPT_OUT_KEY = '_pulse_opt_out';
  var DURABLE_KEY = '_pulse_did';
  var RETRY_KEY = '_pulse_retry';

  // ── Guards ────────────────────────────────────────────────
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host.indexOf('.local') > -1;
  if (isLocal && !TRACK_LOCALHOST) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  function optedOut() {
    try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch (e) { return false; }
  }

  function excluded(path) {
    for (var i = 0; i < EXCLUDES.length; i++) {
      var p = EXCLUDES[i];
      if (p.charAt(p.length - 1) === '*') {
        if (path.indexOf(p.slice(0, -1)) === 0) return true;
      } else if (path === p) return true;
    }
    return false;
  }

  // ── State ─────────────────────────────────────────────────
  var userId = null;
  var currentPath = location.pathname + location.search;
  var pageStart = Date.now();
  var maxScroll = 0;
  var lastPath = null;
  var lastPathAt = 0;
  var queue = [];
  var flushTimer = null;

  function durableId() {
    if (!PERSISTENT) return null;
    try {
      var id = localStorage.getItem(DURABLE_KEY);
      if (!id) {
        id = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(DURABLE_KEY, id);
      }
      return id;
    } catch (e) { return null; }
  }

  // ── Transport ─────────────────────────────────────────────
  // Events are batched over a short window and retried from localStorage, so a
  // transient network failure no longer silently drops data.

  function envelope(batch) {
    return JSON.stringify({
      p: PROJECT_ID,
      d: durableId(),
      uid: userId,
      b: batch
    });
  }

  function persistRetry(batch) {
    try {
      var stored = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]');
      localStorage.setItem(RETRY_KEY, JSON.stringify(stored.concat(batch).slice(-50)));
    } catch (e) { /* storage full or blocked — drop */ }
  }

  function send(batch, useBeacon) {
    if (!batch.length) return;
    var body = envelope(batch);

    // On page hide, fetch can be cancelled; sendBeacon survives the unload.
    if (useBeacon && navigator.sendBeacon) {
      var ok = navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }));
      if (!ok) persistRetry(batch);
      return;
    }

    fetch(API, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      credentials: 'omit',
      mode: 'cors'
    }).then(function (res) {
      if (!res.ok && res.status !== 429) persistRetry(batch);
    }).catch(function () {
      persistRetry(batch);
    });
  }

  function flush(useBeacon) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, queue.length);
    send(batch, useBeacon);
  }

  function flushRetries() {
    try {
      var stored = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]');
      if (!stored.length) return;
      localStorage.removeItem(RETRY_KEY);
      send(stored, false);
    } catch (e) { /* ignore */ }
  }

  function track(type, props, name) {
    if (optedOut()) return;
    var path = location.pathname + location.search;
    if (excluded(location.pathname)) return;

    queue.push({
      t: type,
      n: name || null,
      u: path,
      r: document.referrer || null,
      ts: new Date().toISOString(),
      props: props || null
    });

    // Pageviews go out immediately so the live view is actually live;
    // everything else batches.
    if (type === 'pageview' || queue.length >= 20) flush(false);
    else if (!flushTimer) flushTimer = setTimeout(function () { flush(false); }, 3000);
  }

  // ── Page lifecycle ────────────────────────────────────────

  function utmParams() {
    var params = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    var out = null;
    for (var i = 0; i < keys.length; i++) {
      var v = params.get(keys[i]);
      if (v) { out = out || {}; out[keys[i]] = v; }
    }
    return out;
  }

  function pageview() {
    var now = Date.now();
    var path = location.pathname + location.search;

    // Quick-back / pogosticking: they went somewhere, came straight back.
    // The strongest single signal that the page they left had failed them.
    if (lastPath && lastPath === path && now - lastPathAt < 10000) {
      track('quick_back', { from: currentPath, seconds: Math.round((now - lastPathAt) / 1000) });
    }

    pageStart = now;
    maxScroll = 0;
    currentPath = path;
    track('pageview', utmParams());
  }

  function endPage(useBeacon) {
    if (formState.started && !formState.submitted) reportFormAbandon();

    track('session_end', {
      duration: Math.round((Date.now() - pageStart) / 1000),
      scroll_depth: maxScroll,
      path: currentPath
    });
    flush(useBeacon !== false);
  }

  function onRouteChange() {
    var path = location.pathname + location.search;
    if (path === currentPath) return;

    endPage(false);
    lastPath = currentPath;
    lastPathAt = Date.now();
    resetFormState();
    pageview();
  }

  // ── Scroll depth ──────────────────────────────────────────
  var scrollScheduled = false;
  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(function () {
      scrollScheduled = false;
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) { maxScroll = 100; return; }
      var pct = Math.round((window.scrollY / scrollable) * 100);
      if (pct > maxScroll) maxScroll = Math.min(pct, 100);
    });
  }

  // ── Click handling: autocapture, rage clicks, dead clicks ─

  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[onclick],[data-track]';

  function describe(el) {
    var out = { tag: el.tagName };
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (text) out.text = text;
    if (el.id) out.id = el.id;
    if (el.getAttribute('href')) out.href = el.getAttribute('href').slice(0, 300);
    if (el.dataset && el.dataset.track) out.label = el.dataset.track;
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join(' ');
    if (cls) out.classes = cls;
    out.selector = selectorFor(el);
    return out;
  }

  // A stable-enough selector so goals can be defined retroactively.
  function selectorFor(el) {
    if (el.id) return '#' + el.id;
    var parts = [];
    var node = el;
    for (var depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      var part = node.tagName.toLowerCase();
      if (node.getAttribute && node.getAttribute('data-track')) {
        part += '[data-track="' + node.getAttribute('data-track') + '"]';
        parts.unshift(part);
        break;
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ').slice(0, 200);
  }

  var recentClicks = [];

  function onClick(event) {
    var target = event.target;
    if (!target || target.nodeType !== 1) return;

    detectRageClick(event);

    var interactive = target.closest ? target.closest(INTERACTIVE) : null;

    if (interactive) {
      if (AUTOCAPTURE) {
        var props = describe(interactive);
        // Coordinates relative to the viewport and document — enough to
        // reconstruct a heatmap without storing the DOM tree.
        props.vx = Math.round(event.clientX || 0);
        props.vy = Math.round(event.clientY || 0);
        var docEl = document.documentElement;
        props.dx = Math.round(((event.clientX || 0) + window.scrollX) || 0);
        props.dy = Math.round(((event.clientY || 0) + window.scrollY) || 0);
        props.vw = docEl.clientWidth || window.innerWidth;
        props.vh = docEl.clientHeight || window.innerHeight;
        track('click', props);
      }
    } else {
      detectDeadClick(event, target);
    }
  }

  function detectRageClick(event) {
    var now = Date.now();
    recentClicks.push({ x: event.clientX, y: event.clientY, t: now });
    recentClicks = recentClicks.filter(function (c) { return now - c.t < 1000; });

    if (recentClicks.length < 3) return;
    var first = recentClicks[0];
    var clustered = recentClicks.every(function (c) {
      return Math.abs(c.x - first.x) < 30 && Math.abs(c.y - first.y) < 30;
    });
    if (!clustered) return;

    track('rage_click', {
      x: first.x, y: first.y,
      count: recentClicks.length,
      selector: selectorFor(event.target)
    });
    recentClicks = [];
  }

  /**
   * A dead click is a click on something non-interactive that produced no
   * reaction — no DOM change, no navigation, no network call. That is a user
   * expecting something to be clickable when it is not.
   */
  function detectDeadClick(event, target) {
    var pathBefore = location.pathname + location.search;
    var mutated = false;

    var observer;
    try {
      observer = new MutationObserver(function () { mutated = true; });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    } catch (e) { return; }

    setTimeout(function () {
      observer.disconnect();
      var navigated = (location.pathname + location.search) !== pathBefore;
      if (mutated || navigated) return;
      track('dead_click', {
        x: event.clientX,
        y: event.clientY,
        selector: selectorFor(target),
        text: (target.textContent || '').trim().slice(0, 60)
      });
    }, 1000);
  }

  // ── Forms ─────────────────────────────────────────────────
  // Which field they were on when they gave up is the actionable part.

  var formState = { started: false, submitted: false, name: null, lastField: null, fieldCount: 0 };

  function resetFormState() {
    formState = { started: false, submitted: false, name: null, lastField: null, fieldCount: 0 };
  }

  function fieldName(el) {
    return el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || el.type || 'unnamed';
  }

  function formNameOf(el) {
    var form = el.form || (el.closest ? el.closest('form') : null);
    if (!form) return '(no form)';
    return form.getAttribute('name') || form.getAttribute('id') || form.getAttribute('action') || '(unnamed form)';
  }

  function onFocusIn(event) {
    var el = event.target;
    if (!el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return;
    if (el.type === 'hidden' || el.type === 'submit') return;

    if (!formState.started) {
      formState.started = true;
      formState.name = formNameOf(el);
      track('form_start', { form: formState.name, first_field: fieldName(el) });
    }
    formState.lastField = fieldName(el);
    formState.fieldCount++;
  }

  function onSubmit(event) {
    var form = event.target;
    formState.submitted = true;
    track('form_submit', {
      form: form && form.getAttribute ? (form.getAttribute('name') || form.getAttribute('id') || '(unnamed form)') : '(unnamed form)',
      fields_touched: formState.fieldCount
    });
  }

  function reportFormAbandon() {
    track('form_abandon', {
      form: formState.name,
      last_field: formState.lastField,
      fields_touched: formState.fieldCount
    });
    formState.started = false;
  }

  // ── Errors ────────────────────────────────────────────────

  function onError(event) {
    track('js_error', {
      message: String(event.message || 'Unknown error').slice(0, 500),
      source: String(event.filename || '').slice(0, 300),
      line: event.lineno || null,
      column: event.colno || null,
      stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 2000) : null
    });
  }

  function onRejection(event) {
    var reason = event.reason;
    track('js_error', {
      message: ('Unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason))).slice(0, 500),
      source: null,
      line: null,
      column: null,
      stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : null
    });
  }

  // ── Core Web Vitals ───────────────────────────────────────
  // performance.timing is deprecated and measures the wrong things. These are
  // the metrics Google actually grades, reported once on page hide.

  var vitals = {};

  function observe(type, handler, opts) {
    try {
      var po = new PerformanceObserver(function (list) { list.getEntries().forEach(handler); });
      po.observe(Object.assign({ type: type, buffered: true }, opts || {}));
      return po;
    } catch (e) { return null; }
  }

  function collectVitals() {
    observe('largest-contentful-paint', function (entry) {
      vitals.lcp = Math.round(entry.startTime);
    });

    observe('paint', function (entry) {
      if (entry.name === 'first-contentful-paint') vitals.fcp = Math.round(entry.startTime);
    });

    var clsValue = 0;
    observe('layout-shift', function (entry) {
      if (!entry.hadRecentInput) {
        clsValue += entry.value;
        vitals.cls = Math.round(clsValue * 1000) / 1000;
      }
    });

    // INP approximated by the worst interaction latency observed.
    observe('event', function (entry) {
      var duration = entry.duration;
      if (duration > (vitals.inp || 0)) vitals.inp = Math.round(duration);
    }, { durationThreshold: 40 });

    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        vitals.ttfb = Math.round(nav.responseStart);
        vitals.dom_ready = Math.round(nav.domContentLoadedEventEnd);
        vitals.load_time = Math.round(nav.loadEventEnd || nav.duration);
      }
    } catch (e) { /* ignore */ }
  }

  var vitalsSent = false;
  function reportVitals() {
    if (vitalsSent) return;
    if (!Object.keys(vitals).length) return;
    vitalsSent = true;
    track('performance', vitals);
  }

  // ── Public API ────────────────────────────────────────────

  function pulse(command) {
    var args = Array.prototype.slice.call(arguments, 1);

    switch (command) {
      case 'event':
        track('custom', args[1] || null, args[0]);
        break;
      case 'identify':
        userId = args[0] ? String(args[0]).slice(0, 120) : null;
        if (userId) track('identify', args[1] || null);
        break;
      case 'pageview':
        pageview();
        break;
      case 'opt_out':
        try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch (e) { /* ignore */ }
        break;
      case 'opt_in':
        try { localStorage.removeItem(OPT_OUT_KEY); } catch (e) { /* ignore */ }
        break;
      case 'flush':
        flush(false);
        break;
      default:
        break;
    }
  }

  // Drain anything the page queued via the async stub before this file loaded.
  var pending = (window.pulse && window.pulse.q) || [];
  window.pulse = pulse;
  for (var i = 0; i < pending.length; i++) pulse.apply(null, pending[i]);

  // ── Wiring ────────────────────────────────────────────────

  collectVitals();
  flushRetries();
  pageview();

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { reportVitals(); endPage(true); }
  });
  // pagehide is the reliable unload signal on iOS Safari, where beforeunload never fires.
  window.addEventListener('pagehide', function () { reportVitals(); endPage(true); });

  // SPA route changes.
  var pushState = history.pushState;
  history.pushState = function () { pushState.apply(this, arguments); onRouteChange(); };
  var replaceState = history.replaceState;
  history.replaceState = function () { replaceState.apply(this, arguments); onRouteChange(); };
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);
})(window, document);
