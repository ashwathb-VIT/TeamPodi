/* ============================================================================
   github.js — proof-of-work panel (panel 04)
   ----------------------------------------------------------------------------
   Reads two public, unauthenticated GitHub REST endpoints:

     GET /repos/:owner/:repo                 → stars, last push, description
     GET /repos/:owner/:repo/commits?per_page=8  → recent commits

   Unauthenticated calls are rate limited to 60/hour per IP, so every failure
   mode is handled explicitly and, where possible, falls back to the last good
   response cached in localStorage. The panel never throws into the page.
   ========================================================================== */
window.MHT = window.MHT || {};

(function (MHT) {
  'use strict';

  var store = MHT.store;
  var esc = store.escapeHtml;

  var API = 'https://api.github.com';
  var COMMIT_COUNT = 8;
  var TIMEOUT_MS = 12000;   // a hung request must not strand the panel

  var el = {};
  var inFlight = false;

  /* --- fetching ----------------------------------------------------------- */

  /**
   * One API call, normalised into { ok, data, error }.
   * Errors are turned into friendly sentences here rather than at the call site.
   */
  function apiGet(path) {
    // AbortController is used where available so a stalled connection fails
    // fast with a message instead of leaving the panel on "Fetching…".
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = window.setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, TIMEOUT_MS);

    var options = {
      headers: { 'Accept': 'application/vnd.github+json' },
      cache: 'no-store'
    };
    if (controller) options.signal = controller.signal;

    return fetch(API + path, options).then(function (response) {
      if (response.ok) {
        return response.json().then(function (data) { return { ok: true, data: data }; });
      }
      return response.json().catch(function () { return {}; }).then(function (body) {
        return { ok: false, error: describeError(response, body) };
      });
    }).catch(function () {
      // Network-level failure: offline, DNS, blocked request, or our timeout.
      return {
        ok: false,
        error: timedOut
          ? 'GitHub did not answer within ' + (TIMEOUT_MS / 1000) + ' seconds. Try again in a moment.'
          : 'Could not reach GitHub — check your connection and try again.'
      };
    }).then(function (result) {
      window.clearTimeout(timer);
      return result;
    });
  }

  /** Turn an HTTP response into something a human wants to read. */
  function describeError(response, body) {
    var remaining = response.headers.get('x-ratelimit-remaining');
    var reset = response.headers.get('x-ratelimit-reset');

    if ((response.status === 403 || response.status === 429) && remaining === '0') {
      var when = '';
      if (reset) {
        var at = new Date(Number(reset) * 1000);
        if (isFinite(at.getTime())) {
          when = ' Try again after ' +
            at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + '.';
        }
      }
      return 'GitHub rate limit reached for this network (60 requests/hour without a token).' + when;
    }
    if (response.status === 404) {
      return 'No public repository found at that owner/name. Check the spelling — private repos need a token, which this page deliberately does not ask for.';
    }
    if (response.status === 409) {
      return 'That repository is empty — nothing to show yet.';
    }
    if (response.status >= 500) {
      return 'GitHub returned a server error (' + response.status + '). That one is on them; try again shortly.';
    }
    return 'GitHub said: ' + esc(body && body.message ? body.message : response.status + ' ' + response.statusText);
  }

  /* --- rendering ---------------------------------------------------------- */

  function setStatus(message, kind) {
    el.status.textContent = message;
    el.status.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function renderRepoStats(repo) {
    el.stats.hidden = false;
    el.stats.innerHTML = [
      tile('Stars', formatCount(repo.stargazers_count), '', repo.forks_count + ' forks'),
      tile('Last push', repo.pushed_at ? store.timeAgo(repo.pushed_at) : '—', '',
        repo.default_branch ? 'Default branch: ' + repo.default_branch : ''),
      tile('Open issues', formatCount(repo.open_issues_count), '',
        repo.language ? 'Mostly ' + repo.language : 'No language detected'),
      tile('Watchers', formatCount(repo.subscribers_count == null ? repo.watchers_count : repo.subscribers_count), '',
        repo.private ? 'Private' : 'Public repository')
    ].join('');
  }

  function tile(label, value, unit, foot) {
    // "2 hours ago" is a sentence, not a number — shrink it so it fits on one
    // line next to the numeric tiles.
    var sizeClass = String(value).length > 8 ? ' stat__value--text' : '';
    return '<article class="stat">' +
      '<h3 class="stat__label">' + esc(label) + '</h3>' +
      '<p class="stat__value' + sizeClass + '">' + esc(value) +
        (unit ? '<span class="stat__unit">' + esc(unit) + '</span>' : '') + '</p>' +
      (foot ? '<p class="stat__foot">' + esc(foot) + '</p>' : '') +
    '</article>';
  }

  function formatCount(n) {
    var value = Number(n);
    if (!isFinite(value)) return '—';
    if (value >= 1000) return (Math.round(value / 100) / 10) + 'k';
    return String(value);
  }

  function renderCommits(commits, repoName) {
    el.commitsCard.hidden = false;
    el.commitsHint.textContent = repoName;

    if (!commits.length) {
      el.commits.innerHTML = '<li class="commit"><p class="commit__msg">No commits on the default branch yet.</p></li>';
      return;
    }

    el.commits.innerHTML = commits.map(function (item) {
      var commit = item.commit || {};
      var author = commit.author || {};
      // Commit messages are multi-line; the subject line is what belongs here.
      var subject = String(commit.message || '').split('\n')[0];
      var when = author.date ? store.timeAgo(author.date) : '';
      var who = author.name || (item.author && item.author.login) || 'unknown';

      return '<li class="commit">' +
        '<div>' +
          '<p class="commit__msg">' + esc(subject) + '</p>' +
          '<p class="commit__meta">' + esc(who) + (when ? ' · ' + esc(when) : '') + '</p>' +
        '</div>' +
        '<a class="commit__sha" href="' + esc(item.html_url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(String(item.sha || '').slice(0, 7)) +
          ' <svg class="icon" aria-hidden="true"><use href="#i-link"></use></svg>' +
        '</a>' +
      '</li>';
    }).join('');
  }

  function hideResults() {
    el.stats.hidden = true;
    el.commitsCard.hidden = true;
  }

  /* --- the load cycle ----------------------------------------------------- */

  function cacheKey(user, repo) { return user.toLowerCase() + '/' + repo.toLowerCase(); }

  /** Show the last good response for this repo, if there is one. */
  function showCached(key, reason) {
    var cached = store.getGitHubCache(key);
    if (!cached || !cached.payload) {
      setStatus(reason, 'error');
      hideResults();
      return;
    }
    renderRepoStats(cached.payload.repo);
    renderCommits(cached.payload.commits, key);
    setStatus(reason + ' Showing the last successful fetch from ' +
      store.timeAgo(cached.fetchedAt) + '.', 'error');
  }

  function load(user, repo) {
    if (inFlight) return;
    user = String(user || '').trim();
    repo = String(repo || '').trim();

    if (!user || !repo) {
      setStatus('Enter a GitHub username and a repository name to pull live data.', 'error');
      hideResults();
      return;
    }

    var key = cacheKey(user, repo);
    var path = '/repos/' + encodeURIComponent(user) + '/' + encodeURIComponent(repo);

    inFlight = true;
    el.refresh.disabled = true;
    setStatus('Fetching ' + key + ' from the GitHub API…', 'busy');

    Promise.all([
      apiGet(path),
      apiGet(path + '/commits?per_page=' + COMMIT_COUNT)
    ]).then(function (results) {
      var repoRes = results[0];
      var commitsRes = results[1];

      if (!repoRes.ok) {
        showCached(key, repoRes.error);
        return;
      }

      renderRepoStats(repoRes.data);

      // An empty repo 409s on /commits while the repo itself loads fine.
      var commits = commitsRes.ok && Array.isArray(commitsRes.data) ? commitsRes.data : [];
      renderCommits(commits, key);

      if (commitsRes.ok) {
        store.setGitHubCache(key, { repo: repoRes.data, commits: commits });
        setStatus('Live from the GitHub API · updated just now' +
          (repoRes.data.description ? ' · ' + repoRes.data.description : ''), 'ok');
      } else {
        setStatus('Repo loaded, but commits could not be read. ' + commitsRes.error, 'error');
      }
    }).catch(function (err) {
      // Belt and braces — apiGet already catches, so this is the truly unexpected.
      console.error('[github] unexpected failure', err);
      showCached(key, 'Something went wrong talking to GitHub.');
    }).then(function () {
      inFlight = false;
      el.refresh.disabled = false;
    });
  }

  /* --- events ------------------------------------------------------------- */

  function onSubmit(event) {
    event.preventDefault();
    var user = el.user.value.trim();
    var repo = el.repo.value.trim();

    // Accept a pasted "owner/repo" or full URL in the username box.
    var pasted = user.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (pasted && !repo) {
      user = pasted[1];
      repo = pasted[2];
      el.user.value = user;
      el.repo.value = repo;
    }

    store.setGitHubConfig(user, repo);
    load(user, repo);
  }

  function onRefresh() {
    var cfg = store.getGitHubConfig();
    load(el.user.value.trim() || cfg.user, el.repo.value.trim() || cfg.repo);
  }

  /* --- wiring ------------------------------------------------------------- */

  function init(root) {
    el.form = root.querySelector('[data-gh-form]');
    el.user = root.querySelector('[data-gh-user]');
    el.repo = root.querySelector('[data-gh-repo]');
    el.status = root.querySelector('[data-gh-status]');
    el.stats = root.querySelector('[data-gh-stats]');
    el.commitsCard = root.querySelector('[data-gh-commits-card]');
    el.commits = root.querySelector('[data-gh-commits]');
    el.commitsHint = root.querySelector('[data-gh-commits-hint]');
    el.refresh = root.querySelector('[data-gh-refresh]');

    el.form.addEventListener('submit', onSubmit);
    el.refresh.addEventListener('click', onRefresh);

    // Restore whatever repo was configured last time and load it straight away.
    var cfg = store.getGitHubConfig();
    el.user.value = cfg.user;
    el.repo.value = cfg.repo;

    if (cfg.user && cfg.repo) {
      load(cfg.user, cfg.repo);
    } else {
      setStatus('No repository configured yet — add a username and repo above.');
    }
  }

  MHT.github = { init: init, load: load };
})(window.MHT);
