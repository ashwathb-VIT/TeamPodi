# TeamPodi

TeamPodi, repository for VinHack 2026.

## PULSE — Mental Health Tracker & Improvement Log

A static, single-page mental health tracker. No framework, no backend, no build
step: open `index.html` directly, or serve the folder with any static file
server. Everything a person logs stays in their own browser's `localStorage`.

```
python3 -m http.server 8000     # then open http://localhost:8000
# …or just double-click index.html
```

### What it does

| Step | Section | What lives there |
| --- | --- | --- |
| 01 | Check-in | 1–5 mood scale, optional context tags, the day's journal entry |
| 02 | Journal | Every past entry, searchable by text, tag and date range; edit or delete inline |
| 03 | Insights | Streaks, weekly/monthly averages, mood trend chart, most common tags |
| 04 | Proof of work | Live commits and repo stats for any public GitHub repo |

One entry per calendar day: checking in again on the same day edits that day's
entry rather than adding a second one.

### Files

```
index.html      Semantic markup for all four panels + the inline icon sprite
styles.css      Design tokens and every component style
js/store.js     localStorage, the entry model, date helpers, change pub/sub
js/charts.js    Hand-rolled SVG charts (no charting library)
js/mood.js      Panel 01 — the daily check-in form
js/journal.js   Panel 02 — history, filtering, inline editing
js/insights.js  Panel 03 — stats and the dashboard
js/github.js    Panel 04 — GitHub REST API panel
js/app.js       Tab navigation, pagers, toast, bootstrap
```

The scripts are plain classic scripts sharing a `window.MHT` namespace and
loaded in dependency order, deliberately not ES modules — that keeps
`file://` working, where module imports would be blocked by CORS.

### Customizing

**Colours, spacing, type** — every value lives in the `:root` token block at the
top of `styles.css`. Each panel picks its accent with a `data-accent` attribute
in `index.html` (`lime`, `lavender`, `red`, `pink`); the matching rule sets
`--accent`, and buttons, rules, focus rings and charts all follow from it.

**Mood scale and tags** — edit the `MOODS` and `TAGS` arrays at the top of
`js/store.js`. Tag ids are what gets stored, so renaming a `label` is safe;
changing an `id` orphans that tag on existing entries.

**Storage** — keys are versioned (`mht:entries:v1`). Bump the version in
`KEYS` and migrate in `normalise()` if the entry shape changes.

**Adding a section** — add a `<section class="panel" data-panel="…">` in
`index.html`, a matching `<button class="tab">`, and an entry in the `PANELS`
array in `js/app.js`. The pager arrows and keyboard navigation pick it up
automatically.

### GitHub panel notes

It calls the public, unauthenticated REST API, which is rate limited to 60
requests per hour per IP. The panel never asks for a token, so it can only read
public repositories. Failures — 404, rate limit, server error, timeout, offline
— each produce a specific message, and the last successful response is cached
so a rate-limited refresh still shows the previous data.

### Privacy

Nothing is sent anywhere. The only outbound request the page makes is to
`api.github.com`, and only when a repository is configured on step 04.
