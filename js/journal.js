/* ============================================================================
   journal.js — history, search and editing (panel 02)
   ----------------------------------------------------------------------------
   Lists every stored entry newest-first, filtered by free text, tag and date
   range. Each row can be expanded into an inline editor (mood, tags, note) or
   deleted outright.

   The list is re-rendered from the store on every change, so there is no view
   state to keep in sync beyond "which row is currently being edited".
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var store = MHT.store;
  var esc = store.escapeHtml;

  var el = {};
  var editingId = null;     // id of the entry open in the inline editor
  var editDraft = null;     // { mood, tags } while editing

  /* --- filtering ---------------------------------------------------------- */

  function currentFilters() {
    return {
      text: el.search.value.trim().toLowerCase(),
      tag: el.tag.value,
      from: el.from.value,
      to: el.to.value
    };
  }

  function applyFilters(entries) {
    var f = currentFilters();
    return entries.filter(function (entry) {
      if (f.tag && entry.tags.indexOf(f.tag) === -1) return false;
      if (f.from && entry.date < f.from) return false;
      if (f.to && entry.date > f.to) return false;
      if (f.text) {
        var haystack = (entry.note + ' ' + entry.date + ' ' +
          entry.tags.map(function (t) { return store.TAG_LABELS[t] || t; }).join(' ')
        ).toLowerCase();
        if (haystack.indexOf(f.text) === -1) return false;
      }
      return true;
    });
  }

  /* --- rendering ---------------------------------------------------------- */

  function moodFace(value) {
    var m = store.MOODS[value - 1];
    return m ? m.face : '';
  }

  function tagChips(tags) {
    if (!tags.length) return '';
    return '<div class="chips">' + tags.map(function (t) {
      return '<span class="chip chip--static">' + esc(store.TAG_LABELS[t] || t) + '</span>';
    }).join('') + '</div>';
  }

  /** A read-only entry row. */
  function entryRow(entry) {
    var note = entry.note
      ? '<p class="entry__note">' + esc(entry.note) + '</p>'
      : '<p class="entry__note entry__note--empty">No journal text for this day.</p>';

    return '<article class="entry" data-entry="' + esc(entry.id) + '">' +
      '<div class="entry__score">' +
        '<span class="entry__face" aria-hidden="true">' + moodFace(entry.mood) + '</span>' +
        '<span class="entry__score-value">' + entry.mood + '/5</span>' +
      '</div>' +
      '<div class="entry__body">' +
        '<h3 class="entry__date">' + esc(store.formatLong(entry.date)) + '</h3>' +
        '<p class="entry__meta">Updated ' + esc(store.timeAgo(entry.updatedAt)) + '</p>' +
        note +
        tagChips(entry.tags) +
      '</div>' +
      '<div class="entry__actions">' +
        '<button class="iconbtn iconbtn--sm" type="button" data-edit="' + esc(entry.id) + '"' +
        ' aria-label="Edit entry for ' + esc(store.formatLong(entry.date)) + '">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-pencil"></use></svg>' +
        '</button>' +
        '<button class="iconbtn iconbtn--sm" type="button" data-delete="' + esc(entry.id) + '"' +
        ' aria-label="Delete entry for ' + esc(store.formatLong(entry.date)) + '">' +
          '<svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>' +
        '</button>' +
      '</div>' +
    '</article>';
  }

  /** The same row, swapped for an inline editor. */
  function editorRow(entry) {
    var moodButtons = store.MOODS.map(function (m) {
      return '<button class="mood-mini__btn" type="button" data-edit-mood="' + m.value + '"' +
             ' aria-pressed="' + (editDraft.mood === m.value ? 'true' : 'false') + '"' +
             ' aria-label="Mood ' + m.value + ' — ' + esc(m.label) + '">' + m.value + '</button>';
    }).join('');

    var chips = store.TAGS.map(function (t) {
      var on = editDraft.tags.indexOf(t.id) > -1;
      return '<button class="chip" type="button" data-edit-tag="' + esc(t.id) + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }).join('');

    return '<article class="entry entry--editing" data-entry="' + esc(entry.id) + '">' +
      '<div class="entry__edit">' +
        '<h3 class="entry__date">Editing — ' + esc(store.formatLong(entry.date)) + '</h3>' +
        '<div class="entry__edit-row">' +
          '<span class="field__label">Mood</span>' +
          '<div class="mood-mini" role="group" aria-label="Mood rating">' + moodButtons + '</div>' +
        '</div>' +
        '<div class="entry__edit-row"><span class="field__label">Tags</span></div>' +
        '<div class="chips">' + chips + '</div>' +
        '<label class="sr-only" for="edit-note-' + esc(entry.id) + '">Journal entry</label>' +
        '<textarea class="textarea" id="edit-note-' + esc(entry.id) + '" rows="5"' +
        ' data-edit-note>' + esc(entry.note) + '</textarea>' +
        '<div class="action-group">' +
          '<button class="btn btn--ghost" type="button" data-edit-cancel>Cancel</button>' +
          '<button class="btn btn--primary" type="button" data-edit-save>Save changes</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function emptyState(hasEntries) {
    return '<div class="empty">' +
      '<p class="empty__title">' + (hasEntries ? 'No matches' : 'Nothing logged yet') + '</p>' +
      '<p>' + (hasEntries
        ? 'No entry matches those filters. Try clearing them.'
        : 'Save a check-in on step 01 and it will show up here.') + '</p>' +
    '</div>';
  }

  function render() {
    var all = store.getEntries();
    var visible = applyFilters(all);

    el.count.textContent = String(visible.length);

    el.list.innerHTML = visible.length
      ? visible.map(function (entry) {
          return entry.id === editingId ? editorRow(entry) : entryRow(entry);
        }).join('')
      : emptyState(all.length > 0);
  }

  /** Keep the tag filter in step with whichever tags are actually in use. */
  function renderTagOptions() {
    var used = {};
    store.getEntries().forEach(function (e) {
      e.tags.forEach(function (t) { used[t] = (used[t] || 0) + 1; });
    });
    var selected = el.tag.value;
    var options = ['<option value="">All tags</option>'];
    store.TAGS.forEach(function (t) {
      if (!used[t.id]) return;
      options.push('<option value="' + esc(t.id) + '">' + esc(t.label) +
                   ' (' + used[t.id] + ')</option>');
    });
    el.tag.innerHTML = options.join('');
    el.tag.value = used[selected] ? selected : '';
  }

  /* --- events ------------------------------------------------------------- */

  function startEdit(id) {
    var entry = store.getEntryById(id);
    if (!entry) return;
    editingId = id;
    editDraft = { mood: entry.mood, tags: entry.tags.slice() };
    render();
    var area = el.list.querySelector('[data-edit-note]');
    if (area) area.focus();
  }

  function cancelEdit() {
    editingId = null;
    editDraft = null;
    render();
  }

  function saveEdit() {
    if (!editingId || !editDraft) return;
    var area = el.list.querySelector('[data-edit-note]');
    var id = editingId;
    var patch = {
      mood: editDraft.mood,
      tags: editDraft.tags,
      note: area ? area.value : ''
    };

    // Close the editor *before* writing. The store notifies its listeners
    // synchronously, so the re-render triggered by updateEntry must already
    // see the closed state or the row redraws as an editor again.
    editingId = null;
    editDraft = null;

    store.updateEntry(id, patch);
    MHT.app.toast('Entry updated.');
  }

  function removeEntry(id) {
    var entry = store.getEntryById(id);
    if (!entry) return;
    var ok = window.confirm('Delete the entry for ' + store.formatLong(entry.date) + '? This cannot be undone.');
    if (!ok) return;
    if (editingId === id) { editingId = null; editDraft = null; }
    store.deleteEntry(id);
    MHT.app.toast('Entry deleted.');
  }

  function onListClick(event) {
    var target = event.target;

    var editBtn = target.closest('[data-edit]');
    if (editBtn) return startEdit(editBtn.dataset.edit);

    var delBtn = target.closest('[data-delete]');
    if (delBtn) return removeEntry(delBtn.dataset.delete);

    if (target.closest('[data-edit-cancel]')) return cancelEdit();
    if (target.closest('[data-edit-save]')) return saveEdit();

    var moodBtn = target.closest('[data-edit-mood]');
    if (moodBtn && editDraft) {
      editDraft.mood = Number(moodBtn.dataset.editMood);
      // Re-render only the mood row's pressed states to keep the textarea intact.
      el.list.querySelectorAll('[data-edit-mood]').forEach(function (btn) {
        btn.setAttribute('aria-pressed', Number(btn.dataset.editMood) === editDraft.mood ? 'true' : 'false');
      });
      return;
    }

    var tagBtn = target.closest('[data-edit-tag]');
    if (tagBtn && editDraft) {
      var id = tagBtn.dataset.editTag;
      var i = editDraft.tags.indexOf(id);
      if (i > -1) editDraft.tags.splice(i, 1); else editDraft.tags.push(id);
      tagBtn.setAttribute('aria-pressed', i > -1 ? 'false' : 'true');
    }
  }

  function clearFilters() {
    el.search.value = '';
    el.tag.value = '';
    el.from.value = '';
    el.to.value = '';
    render();
  }

  /* --- wiring ------------------------------------------------------------- */

  function init(root) {
    el.list = root.querySelector('[data-journal-list]');
    el.count = root.querySelector('[data-journal-count]');
    el.search = root.querySelector('[data-journal-search]');
    el.tag = root.querySelector('[data-journal-tag]');
    el.from = root.querySelector('[data-journal-from]');
    el.to = root.querySelector('[data-journal-to]');

    el.search.addEventListener('input', render);
    el.tag.addEventListener('change', render);
    el.from.addEventListener('change', render);
    el.to.addEventListener('change', render);
    root.querySelector('[data-journal-clear]').addEventListener('click', clearFilters);
    el.list.addEventListener('click', onListClick);

    store.subscribe(function () {
      renderTagOptions();
      render();
    });

    renderTagOptions();
    render();
  }

  MHT.journal = { init: init, render: render };
})(window.MHT);
