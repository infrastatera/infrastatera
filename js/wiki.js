// InfraStatera wiki — search box. Reads wiki/search.json (built with the pages) and searches in the browser.
(function () {
  'use strict';
  var box = document.querySelector('[data-wiki-search]');
  if (!box) return;
  var input = box.querySelector('input');
  var list = box.querySelector('.wiki-search-results');
  var base = box.getAttribute('data-base');
  var here = box.getAttribute('data-space');
  var index = null;
  var names = {};
  var hits = [];
  var active = 0;

  function load() {
    if (index) return Promise.resolve(index);
    return fetch(box.getAttribute('data-index')).then(function (r) { return r.json(); }).then(function (d) {
      // { spaces: {slug: name}, items: [...] }; older copies were a plain list.
      index = Array.isArray(d) ? d : d.items;
      names = d.spaces || {};
      return index;
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Every word must appear; title matches first, then this knowledge base before the others.
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return index
      .map(function (e) {
        var title = e.t.toLowerCase();
        var all = (e.t + ' ' + e.s + ' ' + e.x).toLowerCase();
        if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return null;
        var score = words.filter(function (w) { return title.indexOf(w) >= 0; }).length * 2 + (here && e.b === here ? 1 : 0);
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
        ? hits.map(function (h, i) { return '<a role="option" href="' + base + h.u + '" aria-selected="' + (i === 0) + '"><b>' + esc(h.t) + '</b><small>' + (h.b && h.b !== here && names[h.b] ? '<span class="wiki-hit-space">' + esc(names[h.b]) + '</span> ' : '') + (h.k === 'Article' ? '' : h.k + ' · ') + esc(h.s) + '</small></a>'; }).join('')
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

// Materials library: filter by system and by text.
(function () {
  'use strict';
  var tools = document.querySelector('[data-mat-filter]');
  if (!tools) return;
  var input = tools.querySelector('input');
  var chips = tools.querySelectorAll('button[data-g]');
  var rows = document.querySelectorAll('table.wiki-mat tbody tr');
  var groups = document.querySelectorAll('.wiki-mat-group');
  var none = document.querySelector('[data-mat-none]');
  var count = tools.querySelector('[data-mat-count]');
  var group = 'all';
  var original = new Map();
  rows.forEach(function (r) { original.set(r, r.innerHTML); });

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Marks the typed words in a row's text (never inside tags), so a match is easy to see.
  function mark(r, words) {
    r.innerHTML = original.get(r);
    if (!words.length) return;
    var re = new RegExp('(' + words.map(escRe).join('|') + ')', 'gi');
    var walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      if (!re.test(n.nodeValue)) return;
      re.lastIndex = 0;
      var span = document.createElement('span');
      span.innerHTML = n.nodeValue.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(re, '<mark>$1</mark>');
      n.parentNode.replaceChild(span, n);
    });
  }

  function apply(scroll) {
    var q = input.value.trim();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var shown = 0;
    rows.forEach(function (r) {
      var text = original.get(r).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').toLowerCase();
      var ok = (group === 'all' || r.getAttribute('data-group') === group) && words.every(function (w) { return text.indexOf(w) >= 0; });
      r.hidden = !ok;
      mark(r, ok ? words : []);
      if (ok) shown++;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector('tbody tr:not([hidden])'); });
    none.hidden = shown > 0;
    if (count) count.textContent = (words.length || group !== 'all')
      ? shown + ' of ' + rows.length + ' ' + (count.getAttribute('data-noun') || 'materials') + (words.length ? ' match \u201c' + q + '\u201d' : '')
      : '';
    // Bring the first match up under the filter bar if the page was scrolled past it.
    if (scroll) {
      var first = document.querySelector('.wiki-mat-group:not([hidden])');
      var barBottom = tools.getBoundingClientRect().bottom;
      if (first && first.getBoundingClientRect().top < barBottom) {
        window.scrollTo({ top: window.scrollY + first.getBoundingClientRect().top - barBottom - 8 });
      }
    }
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      group = c.getAttribute('data-g');
      chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      apply(true);
    });
  });
  input.addEventListener('input', function () { apply(true); });
  input.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var first = document.querySelector('table.wiki-mat tbody tr:not([hidden])');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // Opening a material from the search (#its-row) clears the filter so the row shows, then marks it.
  function reveal() {
    var id = decodeURIComponent(location.hash.slice(1));
    var row = id && document.getElementById(id);
    if (!row || !row.closest('table.wiki-mat')) return;
    input.value = '';
    group = 'all';
    chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-g') === 'all')); });
    apply();
    row.scrollIntoView({ block: 'center' });
  }
  window.addEventListener('hashchange', reveal);
  reveal();
})();

// Left navigation: open on wide screens, a collapsed "Browse the wiki" panel on phones; keep the current page in view.
(function () {
  'use strict';
  var side = document.querySelector('[data-wiki-side]');
  if (!side) return;
  var wide = window.matchMedia('(min-width: 901px)');
  var bar = document.querySelector('.wiki-bar');
  // On phones the panel sticks just under the wiki bar, whose height changes with the screen.
  function place() {
    side.style.top = (!wide.matches && bar) ? (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight + 8 + 'px' : '';
  }
  function sync() { side.open = wide.matches; place(); }
  sync();
  window.addEventListener('resize', place);
  if (wide.addEventListener) wide.addEventListener('change', sync);
  var cur = side.querySelector('[aria-current="page"]');
  var nav = side.querySelector('nav');
  function centre() {
    if (!cur) return;
    var box = wide.matches ? side : nav;
    var top = cur.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 2;
    if (top > 0) box.scrollTop = top;
  }
  centre();
  // On phones the panel opens over the page; show where you are in the list.
  side.addEventListener('toggle', function () { if (side.open && !wide.matches) centre(); });
})();
