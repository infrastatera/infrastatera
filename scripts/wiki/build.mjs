#!/usr/bin/env node
// Builds infrastatera.com/wiki from the published knowledge base in the InfraStatera platform database.
//
//   node scripts/wiki/build.mjs                 reads the database (WIKI_SUPABASE_URL + WIKI_SUPABASE_KEY)
//   node scripts/wiki/build.mjs --from data.json   reads a saved copy instead (for previews)
//
// Writes wiki/ (one folder per article, plus glossary/ and search.json) and the wiki part of sitemap.xml.
// Everything in wiki/ is generated: edit articles in the database, not these files.
// The GitHub Action .github/workflows/wiki.yml runs this nightly and on demand.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { anchor, esc, outline, plain, renderMarkdown } from './markdown.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'wiki');
const SITE = 'https://infrastatera.com';

const PHASES = [
  'Preconstruction & design review', 'Underground construction', 'Pull boxes & foundations', 'Structure installation',
  'Cable installation', 'Equipment installation', 'Fiber splicing & termination', 'Network & system configuration',
  'System testing', 'Caltrans acceptance testing', 'Punch list', 'Closeout & delivery',
];
const LINK_LABEL = { see_also: 'See also', prerequisite: 'Read first', next_step: 'Next', inline: 'Mentioned' };
const DISCLAIMER = 'For learning only. Not affiliated with or endorsed by Caltrans, and not a contract interpretation: always refer to the contract documents for your project.';

// ── data ────────────────────────────────────────────────────────────────────
async function load() {
  const from = process.argv.indexOf('--from');
  if (from > 0) return JSON.parse(await readFile(process.argv[from + 1], 'utf8'));
  const url = process.env.WIKI_SUPABASE_URL;
  const key = process.env.WIKI_SUPABASE_KEY;
  if (!url || !key) throw new Error('Set WIKI_SUPABASE_URL and WIKI_SUPABASE_KEY, or pass --from <file>.');
  const get = async (path) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  // The public key only reads what is published (database rules), so drafts never reach the site.
  const [categories, articles, tags, article_tags, links, glossary, related, materials] = await Promise.all([
    get('kb_categories?select=*&order=sort_order'),
    get('kb_articles?select=id,slug,title,summary,body_md,article_type,category_id,phase_number,sort_order,spec_edition,last_verified,common_mistakes,updated_at,published_at&status=eq.published&order=sort_order,title'),
    get('kb_tags?select=*'),
    get('kb_article_tags?select=*'),
    get('kb_article_links?select=*'),
    get('kb_glossary?select=id,term,expansion,definition,aliases,article_id&order=term'),
    get('kb_related?select=*&order=shared_tags.desc'),
    get('kb_materials?select=name,function,system_group,phase_number,spec_section,article_id,sort_order&order=sort_order,name'),
  ]);
  return { categories, articles, tags, article_tags, links, glossary, related, materials };
}

// Browsers keep scripts and styles for a while; a version from their contents makes them load the new
// file as soon as it changes.
let VERSION = {};
async function stamp() {
  for (const f of ['css/style.css', 'css/wiki.css', 'js/main.js', 'js/wiki.js']) {
    VERSION[f] = createHash('sha1').update(await readFile(join(ROOT, f))).digest('hex').slice(0, 8);
  }
}
const asset = (up, f) => `${up}${f}?v=${VERSION[f]}`;

// ── page frame (same header and footer as the rest of the site) ───────────
function page({ up, title, description, path, body, crumbs = [], image, type = 'article', jsonLd = [] }) {
  const url = `${SITE}/${path}`;
  // Share image: a PNG made from the page's illustration (LinkedIn and others don't show SVG).
  const ogImage = `${SITE}/assets/wiki/og/${(image || 'lifecycle.svg').replace(/\.svg$/, '.png')}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'InfraStatera', item: `${SITE}/` }, { name: 'Wiki', item: `${SITE}/wiki/` }, ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, ...c })),
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#FFFFFF">
  <link rel="icon" type="image/svg+xml" href="${up}assets/favicon.svg">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="InfraStatera">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600&display=swap">
  <link rel="stylesheet" href="${asset(up, 'css/style.css')}">
  <link rel="stylesheet" href="${asset(up, 'css/wiki.css')}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${ogImage}">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>${jsonLd.map((j) => `\n  <script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}
</head>
<body>
  <!-- Generated by scripts/wiki/build.mjs from the knowledge base. Don't edit: changes are overwritten. -->
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="nav">
    <div class="nav-inner">
      <a href="${up}" class="brand" aria-label="InfraStatera home">
        <img src="${up}assets/logo.svg" alt="" width="32" height="32">
        <span>InfraStatera</span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu" aria-label="Open menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <nav class="nav-menu" id="nav-menu" aria-label="Primary">
        <a href="${up}demo/">Demos</a>
        <a href="${up}wiki/" aria-current="page">Wiki</a>
        <a href="${up}#services">Services</a>
        <a href="${up}#process">Process</a>
        <a href="${up}#why">Why us</a>
        <a href="${up}start/?need=audit" class="btn btn-primary btn-sm">Book an audit</a>
      </nav>
    </div>
  </header>

  <main id="main" class="wiki">
    <div class="wiki-bar">
      <nav class="wiki-tabs" aria-label="Wiki">
        <a href="${up}wiki/">Home</a>
        <a href="${up}wiki/#lifecycle">Lifecycle</a>
        <a href="${up}wiki/materials/">Materials</a>
        <a href="${up}wiki/glossary/">Glossary</a>
      </nav>
      <div class="wiki-search" data-wiki-search data-index="${up}wiki/search.json" data-base="${up}wiki/">
        <input type="search" role="combobox" aria-label="Search the wiki" aria-expanded="false" aria-controls="wiki-search-results" placeholder="Search articles, materials and terms…">
        <div id="wiki-search-results" class="wiki-search-results" role="listbox" hidden></div>
      </div>
    </div>
${body}
    <p class="wiki-disclaimer">${DISCLAIMER}</p>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <img src="${up}assets/logo.svg" alt="" width="28" height="28">
        <span>InfraStatera</span>
      </div>
      <div class="footer-cols">
        <div>
          <h2>Explore</h2>
          <a href="${up}demo/">All demos</a>
          <a href="${up}wiki/">Wiki</a>
          <a href="${up}wiki/materials/">Materials</a>
          <a href="${up}wiki/glossary/">Glossary</a>
        </div>
        <div>
          <h2>Services</h2>
          <a href="${up}#services">Audit &amp; Strategy</a>
          <a href="${up}#services">Custom Field Apps</a>
          <a href="${up}#services">Smart Infrastructure &amp; AI</a>
          <a href="${up}#services">Training &amp; Adoption</a>
        </div>
        <div>
          <h2>Contact</h2>
          <a href="mailto:infrastatera@gmail.com">infrastatera@gmail.com</a>
          <span>Los Angeles, California</span>
        </div>
      </div>
      <div class="footer-legal">
        <span>© <span id="year">2026</span> InfraStatera. All rights reserved.</span>
      </div>
    </div>
  </footer>

  <script src="${asset(up, 'js/main.js')}" defer></script>
  <script src="${asset(up, 'js/wiki.js')}" defer></script>
</body>
</html>
`;
}

const PUBLISHER = { '@type': 'Organization', name: 'InfraStatera', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/assets/logo.svg` } };
const GROUPS = [
  ['civil', 'Civil', 'Conduit, boxes, foundations and structures'],
  ['electrical', 'Electrical', 'Cabinets, power, grounding and field devices'],
  ['communications', 'Communications', 'Fiber, network equipment, cameras and signs'],
  ['power', 'Power', 'Utility service, solar and batteries'],
];
const firstImage = (md) => (/!\[[^\]]*\]\(([\w.-]+\.svg)/.exec(md) || [])[1];

const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// ── build ───────────────────────────────────────────────────────────────────
async function main() {
  await stamp();
  const d = await load();
  const articles = d.articles;
  const byId = new Map(articles.map((a) => [a.id, a]));
  const bySlug = Object.fromEntries(articles.map((a) => [a.slug, { slug: a.slug, title: a.title }]));
  const glossary = d.glossary.map((g) => ({ term: g.term, aliases: g.aliases ?? [] }));
  const tagsById = new Map(d.tags.map((t) => [t.id, t]));
  const catById = new Map(d.categories.map((c) => [c.id, c]));

  // Left navigation: every section and its articles, with the lifecycle phases in order.
  // Pages using it all sit at wiki/<page>/, so links are ../<slug>/.
  const sideNav = (current) => {
    // Short labels, like a docs menu: the part of the title before its colon.
    const link = (slug, label) => `<li><a href="../${slug}/"${slug === current ? ' aria-current="page"' : ''}>${esc(label.split(': ')[0])}</a></li>`;
    const groups = d.categories.filter((c) => c.slug !== 'glossary').map((c) => {
      let items;
      if (c.slug === 'project-lifecycle') {
        const overview = articles.filter((a) => a.category_id === c.id && a.article_type !== 'phase');
        const phases = articles.filter((a) => a.article_type === 'phase' && a.phase_number).sort((a, b) => a.phase_number - b.phase_number);
        items = overview.map((a) => link(a.slug, a.slug === 'lifecycle-overview' ? 'Overview of the twelve phases' : a.title)).join('')
          + phases.map((a) => `<li><a href="../${a.slug}/"${a.slug === current ? ' aria-current="page"' : ''}><span class="wiki-side-n">${a.phase_number}</span>${esc(a.title.replace(/^Phase \d+: /, ''))}</a></li>`).join('');
      } else {
        items = articles.filter((a) => a.category_id === c.id && a.article_type !== 'phase').map((a) => link(a.slug, a.title)).join('');
      }
      if (!items) return '';
      return `<div class="wiki-side-group"><p class="wiki-side-h">${esc(c.title)}</p><ul>${items}</ul></div>`;
    }).join('');
    const tools = `<div class="wiki-side-group"><p class="wiki-side-h">Reference</p><ul>${link('materials', 'Materials library')}${link('glossary', 'Glossary')}</ul></div>`;
    return `<details class="wiki-side" data-wiki-side open>
        <summary>Browse the wiki</summary>
        <nav aria-label="All wiki articles">${groups}${tools}</nav>
      </details>`;
  };
  const withSide = (current, inner) => `
    <div class="wiki-layout">
      ${sideNav(current)}
      <div class="wiki-main">${inner}
      </div>
    </div>`;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Home
  const phasePages = new Map(articles.filter((a) => a.article_type === 'phase' && a.phase_number).map((a) => [a.phase_number, a]));
  const lifecycle = articles.find((a) => a.slug === 'lifecycle-overview');
  const phases = PHASES.map((name, i) => {
    const a = phasePages.get(i + 1);
    const inner = `<span class="tier">Phase ${i + 1}</span><b>${esc(a?.title ?? name)}</b>`;
    return a ? `<a class="wiki-phase" href="${a.slug}/">${inner}</a>` : `<div class="wiki-phase is-empty" title="Coming soon">${inner}</div>`;
  }).join('\n        ');
  const sections = d.categories.filter((c) => c.slug !== 'glossary').map((c) => {
    const list = articles.filter((a) => a.category_id === c.id && a.article_type !== 'phase');
    const items = list.length
      ? `<ul>${list.map((a) => `<li><a href="${a.slug}/">${esc(a.title)}${a.summary ? `<small>${esc(a.summary)}</small>` : ''}</a></li>`).join('')}</ul>`
      : '<p class="wiki-empty">Articles coming soon.</p>';
    return `<section class="wiki-card"><h3>${esc(c.title)}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ''}${items}</section>`;
  }).join('\n        ');
  await writeFile(join(OUT, 'index.html'), page({
    up: '../',
    title: 'Wiki — Caltrans electrical work, explained — InfraStatera',
    description: 'How a general contractor runs Caltrans electrical projects: Standard Specifications, Special Provisions, plans, the twelve phases of a job and the materials used.',
    path: 'wiki/',
    type: 'website',
    image: 'lifecycle.svg',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'InfraStatera Wiki', description: 'Caltrans electrical work, explained.', url: `${SITE}/wiki/`, publisher: PUBLISHER }],
    body: `
    <section class="page-head">
      <p class="tier">Wiki</p>
      <h1>Caltrans electrical work, explained</h1>
      <p class="page-head-lead">How a general contractor runs Caltrans electrical projects day to day: the contract documents, the twelve phases of a job, the materials and what they are for, and the processes that keep it moving.</p>
    </section>
    <section class="wiki-wrap">
      <h2 id="lifecycle" class="wiki-h2">Project lifecycle</h2>
      ${lifecycle ? `<p class="wiki-intro">Start with the <a href="${lifecycle.slug}/">lifecycle overview</a>, then open any phase.</p>` : ''}
      <div class="wiki-phases">
        ${phases}
      </div>
      <h2 class="wiki-h2">Browse by section</h2>
      <div class="wiki-grid">
        ${sections}
        <section class="wiki-card"><h3>Materials library</h3><p>${d.materials.length} materials and what each one is for, by system and phase.</p><ul><li><a href="materials/">Open the materials library</a></li></ul></section>
        <section class="wiki-card"><h3>Glossary</h3><p>Terms and abbreviations used on Caltrans electrical jobs.</p><ul><li><a href="glossary/">Open the glossary</a></li></ul></section>
      </div>
    </section>`,
  }));

  // Articles
  for (const a of articles) {
    const base = '..';
    const body = a.body_md.replace(/^\s*#\s+.*\n/, '');
    const html = renderMarkdown(body, { articles: bySlug, glossary, base, assets: '../../assets/wiki/' });
    const mistakes = a.common_mistakes ? renderMarkdown(a.common_mistakes, { articles: bySlug, base }) : '';
    const toc = outline(body);
    const chosen = d.links.filter((l) => l.from_article === a.id && byId.has(l.to_article));
    const chosenIds = new Set(chosen.map((l) => l.to_article));
    const related = d.related.filter((r) => r.article_id === a.id && byId.has(r.related_id) && !chosenIds.has(r.related_id)).slice(0, 6).map((r) => byId.get(r.related_id));
    const backlinks = d.links.filter((l) => l.to_article === a.id && byId.has(l.from_article)).map((l) => byId.get(l.from_article));
    const tags = d.article_tags.filter((t) => t.article_id === a.id).map((t) => tagsById.get(t.tag_id)).filter(Boolean);
    const cat = catById.get(a.category_id);
    const side = [
      toc.length > 1 && `<section><p class="tier">On this page</p><ul>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></section>`,
      chosen.length && `<section><p class="tier">Linked articles</p><ul>${chosen.map((l) => `<li>${LINK_LABEL[l.kind] ?? 'See also'}: <a href="../${byId.get(l.to_article).slug}/">${esc(byId.get(l.to_article).title)}</a></li>`).join('')}</ul></section>`,
      related.length && `<section><p class="tier">Related</p><ul>${related.map((r) => `<li><a href="../${r.slug}/">${esc(r.title)}</a></li>`).join('')}</ul></section>`,
      backlinks.length && `<section><p class="tier">Linked from</p><ul>${backlinks.map((r) => `<li><a href="../${r.slug}/">${esc(r.title)}</a></li>`).join('')}</ul></section>`,
      tags.length && `<section><p class="tier">Tags</p><div class="wiki-tags">${tags.map((t) => `<span>${esc(t.label)}</span>`).join('')}</div></section>`,
    ].filter(Boolean).join('\n');
    const meta = [
      a.phase_number && `<span>Phase ${a.phase_number}</span>`,
      a.spec_edition && `<span>${esc(a.spec_edition)}</span>`,
      `<span>${a.last_verified ? `Last verified ${fmtDate(a.last_verified)}` : 'Not yet verified against the current edition'}</span>`,
    ].filter(Boolean).join('');
    await mkdir(join(OUT, a.slug), { recursive: true });
    await writeFile(join(OUT, a.slug, 'index.html'), page({
      up: '../../',
      title: `${a.title} — InfraStatera Wiki`,
      description: a.summary || plain(body).slice(0, 155),
      path: `wiki/${a.slug}/`,
      crumbs: [{ name: a.title, item: `${SITE}/wiki/${a.slug}/` }],
      image: firstImage(a.body_md),
      jsonLd: [{
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: a.title,
        description: a.summary || plain(body).slice(0, 155),
        image: `${SITE}/assets/wiki/og/${(firstImage(a.body_md) || 'lifecycle.svg').replace(/\.svg$/, '.png')}`,
        datePublished: (a.published_at || a.updated_at || '').slice(0, 10) || undefined,
        dateModified: (a.updated_at || '').slice(0, 10) || undefined,
        author: PUBLISHER,
        publisher: PUBLISHER,
        mainEntityOfPage: `${SITE}/wiki/${a.slug}/`,
        articleSection: cat?.title,
        keywords: tags.map((t) => t.label).join(', ') || undefined,
        inLanguage: 'en-US',
      }],
      body: withSide(a.slug, `
    <div class="wiki-wrap wiki-article">
      <article class="wiki-prose">
        <nav class="wiki-crumbs" aria-label="Breadcrumb"><a href="../">Wiki</a>${cat ? ` <span>/</span> <span>${esc(cat.title)}</span>` : ''}</nav>
        <h1>${esc(a.title)}</h1>
        <div class="wiki-meta">${meta}</div>
        ${html}
        ${mistakes ? `<section class="wiki-mistakes"><h2>Common mistakes / what Caltrans actually checks</h2>${mistakes}</section>` : ''}
      </article>
      ${side ? `<aside class="wiki-aside">${side}</aside>` : ''}
    </div>`),
    }));
  }

  // Glossary
  const letters = [...new Set(d.glossary.map((g) => g.term[0].toUpperCase()))];
  const entries = d.glossary.map((g, i) => {
    const first = i === 0 || d.glossary[i - 1].term[0].toUpperCase() !== g.term[0].toUpperCase();
    const art = g.article_id && byId.get(g.article_id);
    return `<div${first ? ` id="letter-${g.term[0].toUpperCase()}"` : ''}><dt id="${anchor(g.term)}">${esc(g.term)}${g.expansion ? `<small>${esc(g.expansion)}</small>` : ''}</dt><dd>${esc(g.definition)}${art ? ` <a href="../${art.slug}/">Read more</a>` : ''}</dd></div>`;
  }).join('\n');
  await mkdir(join(OUT, 'glossary'), { recursive: true });
  await writeFile(join(OUT, 'glossary', 'index.html'), page({
    up: '../../',
    title: 'Glossary — InfraStatera Wiki',
    description: 'Terms and abbreviations used on Caltrans electrical projects, from OTDR to WPCP.',
    path: 'wiki/glossary/',
    crumbs: [{ name: 'Glossary', item: `${SITE}/wiki/glossary/` }],
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'DefinedTermSet',
      name: 'Caltrans electrical work glossary',
      url: `${SITE}/wiki/glossary/`,
      hasDefinedTerm: d.glossary.map((g) => ({ '@type': 'DefinedTerm', name: g.term, alternateName: g.expansion || undefined, description: g.definition, url: `${SITE}/wiki/glossary/#${anchor(g.term)}` })),
    }],
    body: withSide('glossary', `
    <div class="wiki-wrap wiki-glossary">
      <nav class="wiki-crumbs" aria-label="Breadcrumb"><a href="../">Wiki</a> <span>/</span> <span>Glossary</span></nav>
      <h1>Glossary</h1>
      ${d.glossary.length ? `<div class="wiki-letters">${letters.map((l) => `<a href="#letter-${l}">${l}</a>`).join('')}</div><dl>${entries}</dl>` : '<p class="wiki-empty">Terms coming soon.</p>'}
    </div>`),
  }));

  // Materials library
  const slugOfId = new Map(articles.map((a) => [a.id, a.slug]));
  const phaseSlug = (n) => articles.find((x) => x.article_type === 'phase' && x.phase_number === n)?.slug;
  const matRows = (g) => d.materials.filter((m) => m.system_group === g).map((m) => {
    const slug = m.article_id && slugOfId.get(m.article_id);
    return `<tr id="${anchor(m.name)}" data-group="${g}"><th scope="row">${esc(m.name)}</th><td>${esc(m.function)}</td><td>${m.phase_number ? (phaseSlug(m.phase_number) ? `<a href="../${phaseSlug(m.phase_number)}/">Phase ${m.phase_number}</a>` : `Phase ${m.phase_number}`) : ''}</td><td>${m.spec_section ? `Section ${esc(m.spec_section)}` : ''}</td><td>${slug ? `<a href="../${slug}/">Read</a>` : ''}</td></tr>`;
  }).join('');
  const matSections = GROUPS.map(([g, label, blurb]) => `
      <section class="wiki-mat-group" data-group="${g}">
        <h2 id="${g}" class="wiki-h2">${label} <small>${blurb}</small></h2>
        <div class="wiki-table"><table class="wiki-mat">
          <thead><tr><th scope="col">Material</th><th scope="col">What it is for</th><th scope="col">Phase</th><th scope="col">Spec</th><th scope="col"><span class="sr-only">Article</span></th></tr></thead>
          <tbody>${matRows(g)}</tbody>
        </table></div>
      </section>`).join('');
  await mkdir(join(OUT, 'materials'), { recursive: true });
  await writeFile(join(OUT, 'materials', 'index.html'), page({
    up: '../../',
    title: 'Materials library — InfraStatera Wiki',
    description: `${d.materials.length} materials used on Caltrans electrical jobs and what each one is for: conduit, pull boxes, foundations, cabinets, fiber, network equipment, solar and batteries.`,
    path: 'wiki/materials/',
    type: 'website',
    image: 'cabinet-layout.svg',
    crumbs: [{ name: 'Materials library', item: `${SITE}/wiki/materials/` }],
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Materials used on Caltrans electrical jobs',
      numberOfItems: d.materials.length,
      itemListElement: d.materials.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.name, description: m.function, url: `${SITE}/wiki/materials/#${anchor(m.name)}` })),
    }],
    body: withSide('materials', `
    <div class="wiki-wrap">
      <nav class="wiki-crumbs" aria-label="Breadcrumb"><a href="../">Wiki</a> <span>/</span> <span>Materials library</span></nav>
      <div class="wiki-prose"><h1>Materials library</h1></div>
      <p class="wiki-lead">Every material ordered on a typical Caltrans electrical job, what it is for, the phase it is installed in and the article that explains it. Everything supports one of four systems: civil, electrical, communications or power.</p>
      <div class="wiki-mat-tools" data-mat-filter>
        <div class="wiki-chips" role="group" aria-label="System">
          <button type="button" aria-pressed="true" data-g="all">All ${d.materials.length}</button>
          ${GROUPS.map(([g, label]) => `<button type="button" aria-pressed="false" data-g="${g}">${label} ${d.materials.filter((m) => m.system_group === g).length}</button>`).join('')}
        </div>
        <input type="search" aria-label="Filter materials" placeholder="Filter, e.g. conduit, fiber, battery">
        <p class="wiki-mat-count" data-mat-count aria-live="polite"></p>
      </div>
      ${matSections}
      <p class="wiki-empty" data-mat-none hidden>No material matches.</p>
    </div>`),
  }));

  // Search index for the wiki's search box (read in the browser, nothing else is called)
  const index = [
    ...articles.map((a) => ({ t: a.title, s: a.summary || plain(a.body_md).slice(0, 140), u: `${a.slug}/`, k: 'Article', x: plain(a.body_md).slice(0, 4000) })),
    ...d.materials.map((m) => ({ t: m.name, s: m.function, u: `materials/#${anchor(m.name)}`, k: 'Material', x: [m.name, m.function, m.system_group].join(' ') })),
    ...d.glossary.map((g) => ({ t: g.expansion ? `${g.term} — ${g.expansion}` : g.term, s: g.definition.slice(0, 140), u: `glossary/#${anchor(g.term)}`, k: 'Glossary', x: [g.term, g.expansion, g.definition, ...(g.aliases ?? [])].join(' ') })),
  ];
  await writeFile(join(OUT, 'search.json'), JSON.stringify(index));

  // Sitemap: replace the wiki block
  const sitemapPath = join(ROOT, 'sitemap.xml');
  const sitemap = await readFile(sitemapPath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: 'wiki/', lastmod: today },
    { loc: 'wiki/glossary/', lastmod: today },
    { loc: 'wiki/materials/', lastmod: today },
    ...articles.map((a) => ({ loc: `wiki/${a.slug}/`, lastmod: (a.updated_at || today).slice(0, 10) })),
  ];
  const block = `  <!-- wiki:start (generated by scripts/wiki/build.mjs) -->\n${urls.map((u) => `  <url>\n    <loc>${SITE}/${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n')}\n  <!-- wiki:end -->`;
  const next = sitemap.includes('<!-- wiki:start')
    ? sitemap.replace(/ *<!-- wiki:start[\s\S]*?<!-- wiki:end -->/, block)
    : sitemap.replace('</urlset>', `${block}\n</urlset>`);
  // Keep the sitemap's own dates unless something in the wiki changed, so nightly runs don't commit noise.
  const strip = (s) => s.replace(/<lastmod>[^<]*<\/lastmod>/g, '');
  if (strip(next) !== strip(sitemap) || !sitemap.includes('<!-- wiki:start')) await writeFile(sitemapPath, next);

  console.log(`Wiki built: ${articles.length} article(s), ${d.glossary.length} glossary term(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
