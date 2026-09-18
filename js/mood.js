/* ============================================================================
   mood.js — the daily check-in view (panel 01)
   ----------------------------------------------------------------------------
   Renders the 1–5 mood scale and the context-tag chips, keeps a little bit of
   draft state in memory, and writes through to the store on save.

   One entry per day: opening the page on a day that already has a check-in
   pre-fills the form so saving again edits that entry rather than adding a
   duplicate.
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var store = MHT.store;
  var esc = store.escapeHtml;

  var el = {};                   // cached DOM nodes
  var draft = { mood: null, tags: [], note: '' };
  var loadedStamp = null;        // updatedAt of the entry the draft was filled from

  /* --- rendering ---------------------------------------------------------- */

  /*
   * The scale and the chips are built once and then updated in place. A full
   * re-render on every toggle would replace the node the user just clicked,
   * throwing away focus and breaking arrow-key navigation.
   */

  /** Build the five mood buttons. A radiogroup, so exactly one can be chosen. */
  function buildScale() {
    el.scale.innerHTML = store.MOODS.map(function (m) {
      return '<button class="mood" type="button" role="radio" aria-checked="false"' +
             ' tabindex="-1" data-mood="' + m.value + '">' +
             '<span class="mood__face" aria-hidden="true">' + m.face + '</span>' +
             '<span class="mood__value">' + m.value + '</span>' +
             '<span class="mood__label">' + esc(m.label) + '</span>' +
             '</button>';
    }).join('');
  }

  /** Build the context tag chips, toggled independently of each other. */
  function buildTags() {
    el.tags.innerHTML = store.TAGS.map(function (t) {
      return '<button class="chip" type="button" data-tag="' + esc(t.id) + '"' +
             ' aria-pressed="false">' + esc(t.label) + '</button>';
    }).join('');
  }

  /** Reflect draft.mood onto the existing buttons. */
  function syncScale() {
    var buttons = el.scale.querySelectorAll('[data-mood]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var value = Number(btn.dataset.mood);
      var selected = draft.mood === value;
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      // Roving tabindex: the chosen option is the group's single tab stop,
      // falling back to the middle of the scale when nothing is chosen yet.
      btn.tabIndex = (selected || (draft.mood === null && value === 3)) ? 0 : -1;
    });
  }

  /** Reflect draft.tags onto the existing chips. */
  function syncTags() {
    var chips = el.tags.querySelectorAll('[data-tag]');
    Array.prototype.forEach.call(chips, function (chip) {
      chip.setAttribute('aria-pressed',
        draft.tags.indexOf(chip.dataset.tag) > -1 ? 'true' : 'false');
    });
  }

  function renderNoteCount() {
    el.noteCount.textContent = String(draft.note.length);
  }

  /** The line under the form: whether today is already on the record. */
  function renderSaveState() {
    var existing = store.getEntry(store.today());
    if (existing) {
      el.saveState.textContent = 'Saved for today · last updated ' + store.timeAgo(existing.updatedAt);
      el.saveState.classList.add('is-saved');
    } else {
      el.saveState.textContent = 'Nothing logged for today yet.';
      el.saveState.classList.remove('is-saved');
    }
  }

  function render() {
    syncScale();
    syncTags();
    renderNoteCount();
    renderSaveState();
  }

  /* --- draft state -------------------------------------------------------- */

  /** Load today's stored entry (if any) into the draft. */
  function loadToday() {
    var existing = store.getEntry(store.today());
    loadedStamp = existing ? existing.updatedAt : null;
    draft = existing
      ? { mood: existing.mood, tags: existing.tags.slice(), note: existing.note }
      : { mood: null, tags: [], note: '' };
    el.note.value = draft.note;
    render();
  }

  /**
   * React to a change made elsewhere (e.g. the journal's editor).
   * Only refills the form when *today's* entry actually moved, so editing an
   * older entry never throws away a draft being typed here.
   */
  function onStoreChange() {
    var existing = store.getEntry(store.today());
    var stamp = existing ? existing.updatedAt : null;
    if (stamp !== loadedStamp) loadToday();
    else renderSaveState();
  }

  function selectMood(value, focusNode) {
    draft.mood = store.clamp(Number(value), 1, 5);
    syncScale();
    if (focusNode) {
      var next = el.scale.querySelector('[data-mood="' + draft.mood + '"]');
      if (next) next.focus();
    }
  }

  function toggleTag(id) {
    var i = draft.tags.indexOf(id);
    if (i > -1) draft.tags.splice(i, 1);
    else draft.tags.push(id);
    syncTags();
  }

  /* --- events ------------------------------------------------------------- */

  function onScaleClick(event) {
    var btn = event.target.closest('[data-mood]');
    if (btn) selectMood(btn.dataset.mood, false);
  }

  /** Arrow-key support for the radiogroup. */
  function onScaleKeydown(event) {
    var keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    var from = draft.mood === null ? 3 : draft.mood;
    selectMood(store.clamp(from + keys[event.key], 1, 5), true);
  }

  function onTagsClick(event) {
    var btn = event.target.closest('[data-tag]');
    if (btn) toggleTag(btn.dataset.tag);
  }

  function onNoteInput() {
    draft.note = el.note.value;
    renderNoteCount();
  }

  function onSave() {
    if (draft.mood === null) {
      MHT.app.toast('Pick a mood first — the rest is optional.');
      var first = el.scale.querySelector('[data-mood="3"]');
      if (first) first.focus();
      return;
    }
    store.saveEntry({
      date: store.today(),
      mood: draft.mood,
      tags: draft.tags,
      note: el.note.value
    });
    MHT.app.toast('Check-in saved for ' + store.formatLong(store.today()) + '.');
  }

  function onReset() {
    draft = { mood: null, tags: [], note: '' };
    el.note.value = '';
    render();
  }

  /* --- wiring ------------------------------------------------------------- */

  function init(root) {
    el.scale = root.querySelector('[data-mood-scale]');
    el.tags = root.querySelector('[data-tag-list]');
    el.note = root.querySelector('[data-note]');
    el.noteCount = root.querySelector('[data-note-count]');
    el.saveState = root.querySelector('[data-save-state]');
    el.dateLabel = root.querySelector('[data-checkin-date]');

    el.dateLabel.textContent = store.formatLong(store.today());

    buildScale();
    buildTags();

    el.scale.addEventListener('click', onScaleClick);
    el.scale.addEventListener('keydown', onScaleKeydown);
    el.tags.addEventListener('click', onTagsClick);
    el.note.addEventListener('input', onNoteInput);
    root.querySelector('[data-checkin-save]').addEventListener('click', onSave);
    root.querySelector('[data-checkin-reset]').addEventListener('click', onReset);

    loadToday();

    // An edit made in the journal view should be reflected here too.
    store.subscribe(onStoreChange);
  }

  MHT.mood = { init: init, reload: loadToday };
})(window.MHT);
