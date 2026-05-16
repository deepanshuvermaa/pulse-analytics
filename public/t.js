// Pulse Analytics Tracker — t.js
// Drop-in script: <script src="https://your-domain/t.js" data-id="proj_xxx"></script>
(function() {
  'use strict';
  const s = document.currentScript;
  if (!s) return;
  const pid = s.getAttribute('data-id');
  const endpoint = s.src.replace('/t.js', '/api/collect');
  if (!pid) return;

  // Visitor ID (fingerprint hash, no cookies)
  function vid() {
    const raw = [navigator.userAgent, navigator.language, screen.width, screen.height, new Date().getTimezoneOffset()].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
    return 'v_' + Math.abs(h).toString(36);
  }

  // Session ID (new if >30min gap)
  const SESSION_TTL = 30 * 60 * 1000;
  function sid() {
    const k = 'pulse_sid';
    const stored = sessionStorage.getItem(k);
    if (stored) { const d = JSON.parse(stored); if (Date.now() - d.t < SESSION_TTL) { d.t = Date.now(); sessionStorage.setItem(k, JSON.stringify(d)); return d.id; } }
    const id = 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem(k, JSON.stringify({ id, t: Date.now() }));
    return id;
  }

  const visitorId = vid();
  let sessionId = sid();
  let pageEntryTime = Date.now();

  // Send event
  function send(type, data) {
    const payload = { project_id: pid, type, visitor_id: visitorId, session_id: sessionId, path: location.pathname + location.search, referrer: document.referrer || null, timestamp: new Date().toISOString(), ...data };
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    } else {
      fetch(endpoint, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(function(){});
    }
  }

  // UTM params
  function utms() {
    const p = new URLSearchParams(location.search);
    const u = {};
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k) { if (p.get(k)) u[k] = p.get(k); });
    return Object.keys(u).length ? u : null;
  }

  // Pageview
  function trackPageview() {
    pageEntryTime = Date.now();
    sessionId = sid();
    send('pageview', { payload: utms() });
  }

  // Scroll depth
  let maxScroll = 0;
  function trackScroll() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    const pct = Math.round((window.scrollY / h) * 100);
    if (pct > maxScroll) maxScroll = pct;
  }

  // Time on page + scroll on exit
  function trackExit() {
    const duration = Math.round((Date.now() - pageEntryTime) / 1000);
    send('session_end', { payload: { duration, scroll_depth: maxScroll } });
  }

  // Click tracking (buttons and links with data-track or all buttons)
  function trackClick(e) {
    const el = e.target.closest('a, button, [data-track]');
    if (!el) return;
    const data = { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 50) };
    if (el.href) data.href = el.href;
    if (el.dataset.track) data.label = el.dataset.track;
    send('click', { payload: data });
  }

  // SPA navigation detection
  let currentPath = location.pathname + location.search;
  function checkNavigation() {
    const newPath = location.pathname + location.search;
    if (newPath !== currentPath) {
      trackExit();
      currentPath = newPath;
      maxScroll = 0;
      trackPageview();
    }
  }

  // Init
  trackPageview();
  window.addEventListener('scroll', trackScroll, { passive: true });
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') trackExit(); });
  window.addEventListener('beforeunload', trackExit);
  document.addEventListener('click', trackClick);

  // SPA support
  const origPush = history.pushState;
  history.pushState = function() { origPush.apply(this, arguments); checkNavigation(); };
  const origReplace = history.replaceState;
  history.replaceState = function() { origReplace.apply(this, arguments); checkNavigation(); };
  window.addEventListener('popstate', checkNavigation);
})();
