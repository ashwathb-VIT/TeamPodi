/* ============================================================================
   app.js — bootstrap, navigation and shared UI
   ----------------------------------------------------------------------------
   Wires the four panels together: the ribbon tab bar, the circular back/next
   pagers at the foot of each panel, the toast, and the header/footer counters.
   Each feature module owns its own panel; this file only decides which one is
   on screen.
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var store = MHT.store;

  /* Order matters: it drives both the tab bar and the prev/next pagers. */
  var PANELS = [
    { id: 'checkin', label: 'Check-in', module: 'mood' },
    { id: 'journal', label: 'Journal', module: 'journal' },
    { id: 'insights', label: 'Insights', module: 'insights' },
    { id: 'proof', label: 'Proof of work', module: 'github' }
  ];

  var tabs, panels, toastEl;
  var toastTimer = null;
  var activeId = PANELS[0].id;

  /* --- navigation --------------------------------------------------------- */

  function indexOf(id) {
    for (var i = 0; i < PANELS.length; i++) if (PANELS[i].id === id) return i;
    return 0;
  }

  function show(id, options) {
    var opts = options || {};
    activeId = id;

    tabs.forEach(function (tab) {
      var selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });

    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== id;
    });

    var active = tabs[indexOf(id)];
    if (active) {
      if (opts.focusTab) active.focus();
      // The tab strip scrolls horizontally on narrow screens — keep the
      // active step in view without moving the page itself.
      if (typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Keep the address bar in step so a section can be linked or reloaded into.
    if (window.location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }
  }

  /**
   * Switch to whichever panel the URL fragment names.
   * `fallbackToFirst` is only true on first load: an unrecognised fragment
   * arriving later (an anchor to something else on the page) is ignored
   * rather than yanking the reader back to step 01.
   */
  function showFromHash(fallbackToFirst) {
    var hash = window.location.hash.replace('#', '');
    var known = PANELS.some(function (p) { return p.id === hash; });
    if (known) {
      if (hash !== activeId) show(hash, { scroll: false });
    } else if (fallbackToFirst) {
      show(PANELS[0].id, { scroll: false });
    }
  }

  function step(delta) {
    var next = store.clamp(indexOf(activeId) + delta, 0, PANELS.length - 1);
    show(PANELS[next].id);
  }

  /** Standard tablist keyboard behaviour: arrows, Home, End. */
  function onTabKeydown(event) {
    var moves = { ArrowLeft: -1, ArrowRight: 1 };
    var i = indexOf(activeId);
    var next = null;

    if (event.key in moves) next = (i + moves[event.key] + PANELS.length) % PANELS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PANELS.length - 1;
    if (next === null) return;

    event.preventDefault();
    show(PANELS[next].id, { focusTab: true, scroll: false });
  }

  /* --- pagers ------------------------------------------------------------- */

  /** Build the back/next control at the bottom of one panel. */
  function renderPager(panel) {
    var i = indexOf(panel.dataset.panel);
    var prev = PANELS[i - 1];
    var next = PANELS[i + 1];
    var container = panel.querySelector('[data-pager]');
    if (!container) return;

    container.innerHTML =
      '<button class="iconbtn" type="button" data-nav="prev"' +
        (prev ? ' aria-label="Back to ' + store.escapeHtml(prev.label) + '"' : ' disabled aria-label="No previous section"') + '>' +
        '<svg class="icon" aria-hidden="true"><use href="#i-arrow-left"></use></svg>' +
      '</button>' +
      '<span class="pager__label">' +
        (next ? 'Next — <b>' + store.escapeHtml(next.label) + '</b>'
              : 'You are at the end — <b>back to step 01</b> anytime') +
      '</span>' +
      '<button class="iconbtn iconbtn--accent" type="button" data-nav="next"' +
        (next ? ' aria-label="Continue to ' + store.escapeHtml(next.label) + '"' : ' disabled aria-label="No next section"') + '>' +
        '<svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>' +
      '</button>';

    container.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-nav]');
      if (!btn || btn.disabled) return;
      step(btn.dataset.nav === 'next' ? 1 : -1);
    });
  }

  /* --- toast -------------------------------------------------------------- */

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  /* --- header & footer counters ------------------------------------------- */

  function renderCounters() {
    var entries = store.getEntries();
    var footer = document.querySelector('[data-footer-entries]');
    if (footer) footer.textContent = String(entries.length);

    var streak = document.querySelector('[data-header-streak]');
    if (streak) streak.textContent = String(MHT.insights.currentStreak(entries));
  }

  /* --- boot --------------------------------------------------------------- */

  function init() {
    tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
    panels = Array.prototype.slice.call(document.querySelectorAll('[data-panel]'));
    toastEl = document.querySelector('[data-toast]');

    document.querySelector('[data-header-date]').textContent = store.formatLong(store.today());

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { show(tab.dataset.tab, { scroll: false }); });
    });
    document.querySelector('[data-tablist]').addEventListener('keydown', onTabKeydown);

    panels.forEach(renderPager);

    // Hand each panel to the module that owns it.
    panels.forEach(function (panel) {
      var entry = PANELS[indexOf(panel.dataset.panel)];
      var module = MHT[entry.module];
      if (module && typeof module.init === 'function') {
        try {
          module.init(panel);
        } catch (err) {
          // A failure in one panel must not take the rest of the page down.
          console.error('[app] ' + entry.module + ' failed to start', err);
        }
      }
    });

    store.subscribe(renderCounters);
    renderCounters();

    // Deep link support: #journal, #insights, … both on load and when the
    // fragment changes underneath us (back button, hand-edited URL, anchor).
    window.addEventListener('hashchange', function () { showFromHash(false); });
    showFromHash(true);
  }

  MHT.app = { init: init, show: show, toast: toast, PANELS: PANELS };

  // `defer` guarantees the DOM is parsed, but guard anyway.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.MHT);
