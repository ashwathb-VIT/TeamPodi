/* ============================================================================
   store.js — data layer
   ----------------------------------------------------------------------------
   Owns everything that touches localStorage plus the small shared helpers
   (dates, escaping, pub/sub) the view modules lean on.

   Data model — one entry per calendar day:
     {
       id:        "e_l8x1v2k3",       // stable id, survives date edits
       date:      "2026-09-18",       // local calendar day, YYYY-MM-DD
       mood:      4,                  // 1..5
       tags:      ["sleep", "work"],  // ids from store.TAGS
       note:      "…",                // free-text journal entry
       createdAt: "2026-09-18T09:12:00.000Z",
       updatedAt: "2026-09-18T09:12:00.000Z"
     }

   Everything is namespaced under window.MHT so the files can stay plain
   classic scripts (no build step, works from file://).
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  /* --- localStorage keys. Versioned so a future model change can migrate. -- */
  var KEYS = {
    ENTRIES: 'mht:entries:v1',
    GITHUB: 'mht:github:v1',
    GITHUB_CACHE: 'mht:github-cache:v1'
  };

  /* --- Fixed vocabularies ------------------------------------------------- */

  /** The 1–5 mood scale. Kept here so views and charts agree on wording. */
  var MOODS = [
    { value: 1, face: '😞', label: 'Rough' },
    { value: 2, face: '🙁', label: 'Low' },
    { value: 3, face: '😐', label: 'Okay' },
    { value: 4, face: '🙂', label: 'Good' },
    { value: 5, face: '😄', label: 'Great' }
  ];

  /** Context tags. Add or rename freely — ids are what gets stored. */
  var TAGS = [
    { id: 'sleep', label: 'Sleep' },
    { id: 'stress', label: 'Stress' },
    { id: 'exercise', label: 'Exercise' },
    { id: 'social', label: 'Social' },
    { id: 'work', label: 'Work' },
    { id: 'study', label: 'Study' },
    { id: 'family', label: 'Family' },
    { id: 'food', label: 'Food' },
    { id: 'outdoors', label: 'Outdoors' },
    { id: 'rest', label: 'Rest' },
    { id: 'creative', label: 'Creative' },
    { id: 'health', label: 'Health' }
  ];

  var TAG_LABELS = {};
  TAGS.forEach(function (t) { TAG_LABELS[t.id] = t.label; });

  /* --- Small helpers ------------------------------------------------------ */

  function uid() {
    return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** Escape a string for safe interpolation into innerHTML. */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  /* --- Dates. All day keys are LOCAL calendar days, never UTC. ------------- */

  /** Date object -> "YYYY-MM-DD" in local time. */
  function toISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /** "YYYY-MM-DD" -> Date at local midnight (avoids the UTC parsing trap). */
  function fromISODate(iso) {
    var parts = String(iso).split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function today() { return toISODate(new Date()); }

  /** Shift an ISO day string by n days (n may be negative). */
  function addDays(iso, n) {
    var d = fromISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  /** Whole days between two ISO day strings (b - a). */
  function daysBetween(a, b) {
    var MS = 86400000;
    return Math.round((fromISODate(b) - fromISODate(a)) / MS);
  }

  /** "Fri, 18 Sep 2026" */
  function formatLong(iso) {
    return fromISODate(iso).toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  /** "18 Sep" — for chart axes and dense lists. */
  function formatShort(iso) {
    return fromISODate(iso).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short'
    });
  }

  /** Coarse relative time from an ISO timestamp, e.g. "3 days ago". */
  function timeAgo(isoTimestamp) {
    var then = new Date(isoTimestamp).getTime();
    if (!isFinite(then)) return '';
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    var units = [
      [31536000, 'year'], [2592000, 'month'], [604800, 'week'],
      [86400, 'day'], [3600, 'hour'], [60, 'minute']
    ];
    for (var i = 0; i < units.length; i++) {
      var size = units[i][0];
      if (seconds >= size) {
        var n = Math.floor(seconds / size);
        return n + ' ' + units[i][1] + (n > 1 ? 's' : '') + ' ago';
      }
    }
    return 'just now';
  }

  /* --- Raw localStorage access (never throws) ------------------------------ */

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      // Corrupt JSON, or storage blocked (private mode / file:// lockdown).
      console.warn('[store] could not read ' + key, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[store] could not write ' + key, err);
      return false;
    }
  }

  /* --- In-memory state + change notification ------------------------------ */

  var entries = normalise(readJSON(KEYS.ENTRIES, []));
  var listeners = [];

  /** Defensive read of whatever was in storage — drop anything unusable. */
  function normalise(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (e) { return e && typeof e.date === 'string'; })
      .map(function (e) {
        return {
          id: e.id || uid(),
          date: e.date,
          mood: clamp(Number(e.mood) || 3, 1, 5),
          tags: Array.isArray(e.tags) ? e.tags.filter(function (t) { return TAG_LABELS[t]; }) : [],
          note: typeof e.note === 'string' ? e.note : '',
          createdAt: e.createdAt || new Date().toISOString(),
          updatedAt: e.updatedAt || e.createdAt || new Date().toISOString()
        };
      })
      .sort(byDateDesc);
  }

  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }

  function persist() {
    writeJSON(KEYS.ENTRIES, entries);
    listeners.forEach(function (fn) {
      try { fn(entries); } catch (err) { console.error('[store] listener failed', err); }
    });
  }

  /** Subscribe to any change in entries. Returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  /* --- Entry CRUD --------------------------------------------------------- */

  /** All entries, newest first (copy — callers may sort/filter freely). */
  function getEntries() { return entries.slice(); }

  function getEntry(date) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].date === date) return entries[i];
    }
    return null;
  }

  function getEntryById(id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  /**
   * Insert or update the entry for a given day.
   * One entry per date: saving twice for the same day edits it in place.
   * Returns the stored entry.
   */
  function saveEntry(input) {
    var now = new Date().toISOString();
    var date = input.date || today();
    var existing = getEntry(date);

    var record = {
      id: existing ? existing.id : (input.id || uid()),
      date: date,
      mood: clamp(Number(input.mood) || 3, 1, 5),
      tags: Array.isArray(input.tags) ? input.tags.slice() : [],
      note: typeof input.note === 'string' ? input.note.trim() : '',
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    if (existing) {
      entries[entries.indexOf(existing)] = record;
    } else {
      entries.push(record);
    }
    entries.sort(byDateDesc);
    persist();
    return record;
  }

  /** Update an existing entry by id (used by the journal's inline editor). */
  function updateEntry(id, patch) {
    var existing = getEntryById(id);
    if (!existing) return null;

    var updated = {
      id: existing.id,
      date: existing.date,
      mood: patch.mood == null ? existing.mood : clamp(Number(patch.mood), 1, 5),
      tags: Array.isArray(patch.tags) ? patch.tags.slice() : existing.tags,
      note: typeof patch.note === 'string' ? patch.note.trim() : existing.note,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    entries[entries.indexOf(existing)] = updated;
    persist();
    return updated;
  }

  function deleteEntry(id) {
    var before = entries.length;
    entries = entries.filter(function (e) { return e.id !== id; });
    if (entries.length !== before) { persist(); return true; }
    return false;
  }

  /* --- GitHub panel settings + response cache ----------------------------- */

  function getGitHubConfig() {
    var cfg = readJSON(KEYS.GITHUB, {});
    return { user: cfg.user || '', repo: cfg.repo || '' };
  }

  function setGitHubConfig(user, repo) {
    writeJSON(KEYS.GITHUB, { user: String(user || '').trim(), repo: String(repo || '').trim() });
  }

  /** Last good API response, so a rate-limited refresh can still show data. */
  function getGitHubCache(key) {
    var cache = readJSON(KEYS.GITHUB_CACHE, {});
    return cache && cache.key === key ? cache : null;
  }

  function setGitHubCache(key, payload) {
    writeJSON(KEYS.GITHUB_CACHE, {
      key: key, payload: payload, fetchedAt: new Date().toISOString()
    });
  }

  /* --- Public surface ----------------------------------------------------- */
  MHT.store = {
    KEYS: KEYS,
    MOODS: MOODS,
    TAGS: TAGS,
    TAG_LABELS: TAG_LABELS,

    // dates
    toISODate: toISODate,
    fromISODate: fromISODate,
    today: today,
    addDays: addDays,
    daysBetween: daysBetween,
    formatLong: formatLong,
    formatShort: formatShort,
    timeAgo: timeAgo,

    // misc
    escapeHtml: escapeHtml,
    clamp: clamp,
    uid: uid,

    // entries
    subscribe: subscribe,
    getEntries: getEntries,
    getEntry: getEntry,
    getEntryById: getEntryById,
    saveEntry: saveEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,

    // github
    getGitHubConfig: getGitHubConfig,
    setGitHubConfig: setGitHubConfig,
    getGitHubCache: getGitHubCache,
    setGitHubCache: setGitHubCache
  };
})(window.MHT);
