/* ============================================================================
   insights.js — analytics dashboard (panel 03)
   ----------------------------------------------------------------------------
   Pure functions compute the stats from the stored entries; the render half
   turns them into stat tiles and hands day-series data to charts.js.

   Definitions used here:
     streak          consecutive days with an entry, counting back from today
                     (or from yesterday if today is not logged yet, so an
                     unfinished day never looks like a broken streak)
     longest streak  longest run of consecutive logged days ever recorded
     average mood    mean of the mood values inside a window, 1 dp
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var store = MHT.store;
  var esc = store.escapeHtml;

  var el = {};
  var range = 7;      // days shown in the trend chart / tag chart

  /* --- stats -------------------------------------------------------------- */

  /** Map of date -> entry, for O(1) day lookups. */
  function byDate(entries) {
    var map = {};
    entries.forEach(function (e) { map[e.date] = e; });
    return map;
  }

  function currentStreak(entries) {
    if (!entries.length) return 0;
    var map = byDate(entries);
    var today = store.today();
    // Start at today if logged, otherwise yesterday — today may still be ahead.
    var cursor = map[today] ? today : store.addDays(today, -1);
    var count = 0;
    while (map[cursor]) {
      count++;
      cursor = store.addDays(cursor, -1);
    }
    return count;
  }

  function longestStreak(entries) {
    if (!entries.length) return 0;
    var dates = entries.map(function (e) { return e.date; }).sort();
    var best = 1, run = 1;
    for (var i = 1; i < dates.length; i++) {
      run = store.daysBetween(dates[i - 1], dates[i]) === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }

  /** Entries inside the last `days` days, today inclusive. */
  function withinDays(entries, days) {
    var from = store.addDays(store.today(), -(days - 1));
    return entries.filter(function (e) { return e.date >= from && e.date <= store.today(); });
  }

  function averageMood(entries) {
    if (!entries.length) return null;
    var sum = entries.reduce(function (acc, e) { return acc + e.mood; }, 0);
    return Math.round((sum / entries.length) * 10) / 10;
  }

  /** Tag counts inside a set of entries, sorted most-used first. */
  function tagCounts(entries) {
    var counts = {};
    entries.forEach(function (e) {
      e.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts)
      .map(function (id) {
        return { id: id, label: store.TAG_LABELS[id] || id, value: counts[id] };
      })
      .sort(function (a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
  }

  /**
   * One slot per day across the range, oldest first, so gaps stay visible.
   * Days without an entry get value: null.
   */
  function daySeries(entries, days) {
    var map = byDate(entries);
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var date = store.addDays(store.today(), -i);
      out.push({ date: date, value: map[date] ? map[date].mood : null });
    }
    return out;
  }

  /** Change in average mood between the current window and the one before it. */
  function trendDelta(entries, days) {
    var today = store.today();
    var currentFrom = store.addDays(today, -(days - 1));
    var priorFrom = store.addDays(today, -(days * 2 - 1));

    var current = entries.filter(function (e) { return e.date >= currentFrom; });
    var prior = entries.filter(function (e) { return e.date >= priorFrom && e.date < currentFrom; });

    var a = averageMood(current), b = averageMood(prior);
    if (a == null || b == null) return null;
    return Math.round((a - b) * 10) / 10;
  }

  /* --- rendering ---------------------------------------------------------- */

  function statTile(label, value, unit, foot) {
    // Long, word-shaped values ("Outdoors") get the smaller type size so a
    // tile never has to wrap its headline number.
    var sizeClass = String(value).length > 8 ? ' stat__value--text' : '';
    return '<article class="stat">' +
      '<h3 class="stat__label">' + esc(label) + '</h3>' +
      '<p class="stat__value' + sizeClass + '">' + esc(value) +
        (unit ? '<span class="stat__unit">' + esc(unit) + '</span>' : '') +
      '</p>' +
      (foot ? '<p class="stat__foot">' + esc(foot) + '</p>' : '') +
    '</article>';
  }

  function renderStats(entries) {
    var streak = currentStreak(entries);
    var week = averageMood(withinDays(entries, 7));
    var month = averageMood(withinDays(entries, 30));
    var top = tagCounts(withinDays(entries, 30))[0];

    el.stats.innerHTML = [
      statTile('Current streak', streak, streak === 1 ? 'day' : 'days',
        'Longest: ' + longestStreak(entries) + ' days'),
      statTile('Avg mood · 7d', week == null ? '—' : week.toFixed(1), week == null ? '' : '/ 5',
        week == null ? 'No check-ins this week' : withinDays(entries, 7).length + ' check-ins'),
      statTile('Avg mood · 30d', month == null ? '—' : month.toFixed(1), month == null ? '' : '/ 5',
        month == null ? 'No check-ins this month' : withinDays(entries, 30).length + ' check-ins'),
      statTile('Top tag · 30d', top ? top.label : '—', '',
        top ? top.value + ' of the last 30 days' : 'Tag a check-in to see this'),
      statTile('Entries logged', entries.length, entries.length === 1 ? 'entry' : 'entries',
        entries.length ? 'Since ' + store.formatShort(entries[entries.length - 1].date) : 'Nothing yet')
    ].join('');
  }

  function renderTrend(entries) {
    el.trend.innerHTML = MHT.charts.moodTrend(daySeries(entries, range));

    var inRange = withinDays(entries, range);
    var avg = averageMood(inRange);
    var delta = trendDelta(entries, range);

    if (avg == null) {
      el.trendCaption.textContent = 'No check-ins in the last ' + range + ' days.';
      return;
    }
    var direction = delta == null ? ''
      : delta > 0 ? ' · up ' + delta.toFixed(1) + ' on the previous ' + range + ' days'
      : delta < 0 ? ' · down ' + Math.abs(delta).toFixed(1) + ' on the previous ' + range + ' days'
      : ' · level with the previous ' + range + ' days';

    el.trendCaption.textContent = 'Average ' + avg.toFixed(1) + ' / 5 across ' +
      inRange.length + ' check-in' + (inRange.length === 1 ? '' : 's') + direction + '.';
  }

  function renderTags(entries) {
    var rows = tagCounts(withinDays(entries, range)).slice(0, 8);
    el.tagChart.innerHTML = MHT.charts.tagBars(rows);
  }

  function render() {
    var entries = store.getEntries();   // newest first
    renderStats(entries);
    renderTrend(entries);
    renderTags(entries);
    // The header's streak badge is the same number, but app.js owns the
    // chrome outside the panels and updates it from currentStreak() too.
  }

  /* --- events ------------------------------------------------------------- */

  function onRangeClick(event) {
    var btn = event.target.closest('[data-range]');
    if (!btn) return;
    range = Number(btn.dataset.range);
    el.rangeGroup.querySelectorAll('[data-range]').forEach(function (b) {
      b.classList.toggle('is-active', b === btn);
    });
    render();
  }

  /* --- wiring ------------------------------------------------------------- */

  function init(root) {
    el.stats = root.querySelector('[data-stat-grid]');
    el.trend = root.querySelector('[data-trend-chart]');
    el.trendCaption = root.querySelector('[data-trend-caption]');
    el.tagChart = root.querySelector('[data-tag-chart]');
    el.rangeGroup = root.querySelector('[data-range-group]');

    el.rangeGroup.addEventListener('click', onRangeClick);
    store.subscribe(render);
    render();
  }

  MHT.insights = {
    init: init,
    render: render,
    // exported for reuse (and easy unit testing)
    currentStreak: currentStreak,
    longestStreak: longestStreak,
    averageMood: averageMood,
    tagCounts: tagCounts,
    daySeries: daySeries,
    withinDays: withinDays
  };
})(window.MHT);
