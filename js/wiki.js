// InfraStatera wiki — search box. Reads wiki/search.json (built with the pages) and searches in the browser.
(function () {
  'use strict';
  var box = document.querySelector('[data-wiki-search]');
  if (!box) return;
  var input = box.querySelector('input');
  var list = box.querySelector('.wiki-search-results');
  var base = box.getAttribute('data-base');
  var index = null;
  var hits = [];
  var active = 0;

  function load() {
    if (index) return Promise.resolve(index);
    return fetch(box.getAttribute('data-index')).then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Every word must appear; title matches first.
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return index
      .map(function (e) {
        var title = e.t.toLowerCase();
        var all = (e.t + ' ' + e.s + ' ' + e.x).toLowerCase();
        if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return null;
        var score = words.filter(function (w) { return title.indexOf(w) >= 0; }).length;
        return { e: e, score: score };
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 10)
      .map(function (r) { return r.e; });
  }

  function render(q) {
    if (q.length < 2) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    load().then(function () {
      hits = search(q);
      active = 0;
      list.innerHTML = hits.length
        ? hits.map(function (h, i) { return '<a role="option" href="' + base + h.u + '" aria-selected="' + (i === 0) + '"><b>' + esc(h.t) + '</b><small>' + (h.k === 'Glossary' ? 'Glossary · ' : '') + esc(h.s) + '</small></a>'; }).join('')
        : '<p>Nothing found for “' + esc(q) + '”.</p>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    });
  }
  function select(i) {
    var items = list.querySelectorAll('a');
    items.forEach(function (a, j) { a.setAttribute('aria-selected', String(j === i)); });
    active = i;
  }

  input.addEventListener('input', function () { render(input.value.trim()); });
  input.addEventListener('focus', function () { load(); if (input.value.trim().length >= 2) render(input.value.trim()); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { list.hidden = true; return; }
    if (!hits.length || list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select((active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      window.location.href = base + hits[active].u;
    }
  });
  document.addEventListener('click', function (e) { if (!box.contains(e.target)) list.hidden = true; });
})();
