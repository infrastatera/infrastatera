#!/usr/bin/env node
// Builds infrastatera.com/wiki from the published knowledge base in the InfraStatera platform database.
//
//   node scripts/wiki/build.mjs                 reads the database (WIKI_SUPABASE_URL + WIKI_SUPABASE_KEY)
//   node scripts/wiki/build.mjs --from data.json   reads a saved copy instead (for previews)
//
// Writes wiki/ (one folder per article, plus glossary/ and search.json) and the wiki part of sitemap.xml.
// Everything in wiki/ is generated: edit articles in the database, not these files.
// The GitHub Action .github/workflows/wiki.yml runs this nightly and on demand.

import { existsSync } from 'node:fs';
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

// What differs between knowledge bases beyond their rows in kb_spaces. A new knowledge base works with DEFAULT_SPACE
// and can get its own entry here.
const DEFAULT_SPACE = {
  disclaimer: 'For learning only, not professional, legal or engineering advice. Always refer to the contract documents, codes and standards that apply to your project.',
  mistakes: 'Common mistakes',
  image: 'lifecycle.svg',
  library: null,
};
const SPACE_CONFIG = {
  'caltrans-electrical': {
    disclaimer: 'For learning only. Not affiliated with or endorsed by Caltrans, and not a contract interpretation: always refer to the contract documents for your project.',
    mistakes: 'Common mistakes / what Caltrans actually checks',
    image: 'lifecycle.svg',
    phases: PHASES,
    library: {
      title: 'Materials library', noun: 'materials', item: 'Material', col: 'Spec', colPrefix: 'Section ', showPhase: true, image: 'cabinet-layout.svg',
      filter: 'Filter, e.g. conduit, fiber, battery',
      lead: 'Every material ordered on a typical Caltrans electrical job, what it is for, the phase it is installed in and the article that explains it. Everything supports one of four systems: civil, electrical, communications or power.',
      groups: [
        ['civil', 'Civil', 'Conduit, boxes, foundations and structures'],
        ['electrical', 'Electrical', 'Cabinets, power, grounding and field devices'],
        ['communications', 'Communications', 'Fiber, network equipment, cameras and signs'],
        ['power', 'Power', 'Utility service, solar and batteries'],
      ],
    },
  },
  'public-works-contracting': {
    disclaimer: 'For learning only, not legal advice. Rules change and each agency adds its own: always check the contract, the agency and the current law, and ask a construction attorney when money or a license is at stake.',
    mistakes: 'Common mistakes / what agencies actually check',
    image: 'pw-bid-to-payment.svg',
    library: {
      title: 'Forms and documents', noun: 'forms and documents', item: 'Form or document', col: 'From', colPrefix: '', showPhase: false, image: 'pw-paperwork.svg',
      filter: 'Filter, e.g. payroll, bond, DBE',
      lead: 'The forms, registrations and documents a contractor runs into on California public works, what each one is for, who issues or receives it, and the article that explains it.',
      groups: [
        ['bidding', 'Bidding and award', 'Before and right after the bid opening'],
        ['labor', 'Labor and payroll', 'Prevailing wage, apprentices and certified payroll'],
        ['contract', 'Contract and payment', 'Bonds, insurance, payments, changes and closeout'],
      ],
    },
  },
  'structural-inspection': {
    disclaimer: 'For learning only, not engineering advice. Inspections, test methods and their interpretation belong to qualified, certified people working to the standards and the owner\'s procedures that apply.',
    mistakes: 'Common mistakes',
    image: 'ndt-methods-map.svg',
    library: {
      title: 'Equipment library', noun: 'instruments and tools', item: 'Instrument or tool', col: 'Standard', colPrefix: '', showPhase: false, image: 'ndt-toolkit.svg',
      filter: 'Filter, e.g. rebar, crack, ultrasonic',
      lead: 'The instruments and tools used to inspect and test structures, what each one measures, the standard it is usually run to and the article that explains it.',
      groups: [
        ['visual', 'Visual and access', 'Seeing, measuring and reaching the structure'],
        ['concrete', 'Concrete', 'Strength, uniformity, cover, rebar and corrosion'],
        ['steel', 'Steel and welds', 'Cracks, thickness and weld quality'],
        ['monitoring', 'Monitoring', 'Instruments left on the structure'],
      ],
    },
  },
  'procore-for-electrical-gcs': {
    disclaimer: 'Procore is a registered trademark of Procore Technologies, Inc. InfraStatera is not affiliated with or endorsed by Procore. An independent guide written from Procore\'s public help pages: features change, so Procore\'s own help is the reference.',
    mistakes: 'Common mistakes',
    image: 'pc-tools-map.svg',
    library: {
      title: 'Tools at a glance', noun: 'tools', item: 'Tool', col: 'Caltrans equivalent', colPrefix: '', showPhase: false, image: 'pc-tools-map.svg',
      filter: 'Filter, e.g. RFI, budget, photos',
      lead: 'Each Procore tool an electrical GC is likely to use, what it is for, the Caltrans document or practice it lines up with, and the article that explains it.',
      groups: [
        ['field', 'Field', 'Used on site, mostly from the phone'],
        ['documents', 'Documents', 'Plans, specifications and files'],
        ['office', 'Office', 'Questions, submittals and the written record'],
        ['money', 'Money', 'Budget, contracts, changes and billing'],
        ['admin', 'Administration', 'People, permissions and records'],
      ],
    },
  },
  'contractor-license-study-guides': {
    disclaimer: 'For learning only. Not affiliated with or endorsed by the CSLB. Exam outlines, fees and code editions change: check cslb.ca.gov and the current code books before you rely on a number.',
    mistakes: 'Common mistakes',
    image: 'pw-license-classes.svg',
    library: null,
  },
  'running-a-construction-company': {
    disclaimer: 'For learning only, not legal, tax, accounting or financial advice. Laws, amounts and deadlines change: check the official sources linked in each article, and talk to your CPA, attorney, surety agent or insurance broker before you decide.',
    mistakes: 'Common mistakes',
    image: 'rc-cash-gap.svg',
    library: {
      title: 'Key business documents', tab: 'Documents', noun: 'documents', item: 'Document', col: 'Who uses it', colPrefix: '', showPhase: false, image: 'rc-statements.svg',
      filter: 'Filter, e.g. cash, safety, contract',
      lead: 'The documents a small contractor keeps to run the business, what each one is for, who uses it and the article that explains it.',
      groups: [
        ['money', 'Money', 'Costs, cash, statements and bonding'],
        ['people', 'People', 'Hiring, policies and time'],
        ['safety', 'Safety', 'The program, its records and your experience mod'],
        ['work', 'Getting work', 'Prequalification and bidding'],
        ['contracts', 'Contracts and systems', 'Contracts, changes and written processes'],
      ],
    },
  },
};
// Articles that moved to another knowledge base: their old address (under wiki/) and the article's slug. The old
// address keeps a page that sends visitors on to wherever the article is now. Add a line when you move one.
const MOVED_ARTICLES = [
  ['public-works-contracting/c10-electrical-exam-study-guide', 'c10-electrical-exam-study-guide'],
  ['public-works-contracting/class-a-general-engineering-exam-study-guide', 'class-a-general-engineering-exam-study-guide'],
];
const cfg = (slug) => ({ ...DEFAULT_SPACE, ...(SPACE_CONFIG[slug] ?? {}) });
const WIKI_DISCLAIMER = 'For learning only, not professional, legal or engineering advice. Each knowledge base says what to check before you rely on it.';

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
  const [spaces, categories, articles, tags, article_tags, links, glossary, related, materials] = await Promise.all([
    get('kb_spaces?select=id,slug,title,short_title,description,intro_md,sort_order&order=sort_order'),
    get('kb_categories?select=*&order=sort_order'),
    get('kb_articles?select=id,slug,title,summary,body_md,article_type,category_id,space_id,phase_number,sort_order,spec_edition,last_verified,common_mistakes,updated_at,published_at&status=eq.published&order=sort_order,title'),
    get('kb_tags?select=*'),
    get('kb_article_tags?select=*'),
    get('kb_article_links?select=*'),
    get('kb_glossary?select=id,term,expansion,definition,aliases,article_id,space_id&order=term'),
    get('kb_related?select=*&order=shared_tags.desc'),
    get('kb_materials?select=name,function,system_group,phase_number,spec_section,article_id,space_id,sort_order&order=sort_order,name'),
  ]);
  return { spaces, categories, articles, tags, article_tags, links, glossary, related, materials };
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
const ldScript = (j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`;

// ── page frame (same header and footer as the rest of the site) ───────────
// space: the knowledge base the page belongs to (null on the wiki home); it sets the tabs and the disclaimer.
function page({ up, title, description, path, body, crumbs = [], image, type = 'article', jsonLd = [], space = null }) {
  const url = `${SITE}/${path}`;
  // Share image: a PNG made from the page's illustration (LinkedIn and others don't show SVG).
  const ogImage = `${SITE}/assets/wiki/og/${(image || 'lifecycle.svg').replace(/\.svg$/, '.png')}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'InfraStatera', item: `${SITE}/` }, { name: 'Wiki', item: `${SITE}/wiki/` },
      ...(space ? [{ name: space.title, item: `${SITE}/wiki/${space.slug}/` }] : []), ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, ...c })),
  };
  const c = space ? cfg(space.slug) : null;
  const w = `${up}wiki/`;
  const tabs = space
    ? `<a href="${w}" class="wiki-tab-all" title="All knowledge bases">All wikis</a>
        <a href="${w}${space.slug}/">${esc(space.short_title || space.title)}</a>
        ${c.phases ? `<a href="${w}${space.slug}/#lifecycle">Lifecycle</a>` : ''}
        ${c.library ? `<a href="${w}${space.slug}/materials/">${esc(c.library.tab ?? c.library.title.split(' ')[0])}</a>` : ''}
        <a href="${w}${space.slug}/glossary/">Glossary</a>`
    : `<a href="${w}" aria-current="page">All knowledge bases</a>`;
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
  ${ldScript(ld)}${jsonLd.map((j) => `\n  ${ldScript(j)}`).join('')}
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
        <a href="${w}" aria-current="page">Wiki</a>
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
        ${tabs}
      </nav>
      <div class="wiki-search" data-wiki-search data-index="${w}search.json" data-base="${w}"${space ? ` data-space="${space.slug}"` : ''}>
        <input type="search" role="combobox" aria-label="Search the wiki" aria-expanded="false" aria-controls="wiki-search-results" placeholder="${space ? `Search ${esc(space.short_title || space.title)} and all wikis…` : 'Search every knowledge base…'}">
        <div id="wiki-search-results" class="wiki-search-results" role="listbox" hidden></div>
      </div>
    </div>
${body}
    <p class="wiki-disclaimer">${c ? c.disclaimer : WIKI_DISCLAIMER}</p>
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
          <a href="${w}">Wiki</a>
          ${space ? `<a href="${w}${space.slug}/">${esc(space.short_title || space.title)}</a>
          <a href="${w}${space.slug}/glossary/">Glossary</a>` : ''}
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

// A page that has moved: sends the visitor (and search engines, through the canonical link) to the new address,
// keeping any #anchor. GitHub Pages can't send real redirects.
function moved(to) {
  const url = `${SITE}/${to}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Moved — InfraStatera Wiki</title>
  <link rel="canonical" href="${url}">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0; url=${url}">
  <script>location.replace(${JSON.stringify(url)} + location.hash);</script>
</head>
<body><p>This page has moved to <a href="${url}">${url}</a>.</p></body>
</html>
`;
}

const PUBLISHER = { '@type': 'Organization', name: 'InfraStatera', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/assets/logo.svg` } };
const firstImage = (md) => (/!\[[^\]]*\]\(([\w.-]+\.svg)/.exec(md ?? '') || [])[1];
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── build ───────────────────────────────────────────────────────────────────
async function main() {
  await stamp();
  const d = await load();
  const spaces = d.spaces;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  // Only articles of a published knowledge base are built.
  const allArticles = d.articles.filter((a) => spaceById.has(a.space_id));
  const byId = new Map(allArticles.map((a) => [a.id, a]));
  const tagsById = new Map(d.tags.map((t) => [t.id, t]));
  const catById = new Map(d.categories.map((c) => [c.id, c]));
  const reserved = new Set(spaces.map((s) => s.slug));
  for (const a of allArticles) if (reserved.has(a.slug)) throw new Error(`Article slug "${a.slug}" is also a knowledge base's address.`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const index = [];
  const sitemapUrls = [];
  const today = new Date().toISOString().slice(0, 10);
  const summary = [];

  for (const sp of spaces) {
    const c = cfg(sp.slug);
    const SP = join(OUT, sp.slug);
    const spUrl = `wiki/${sp.slug}/`;
    const articles = allArticles.filter((a) => a.space_id === sp.id);
    const categories = d.categories.filter((x) => x.space_id === sp.id);
    const glossaryRows = d.glossary.filter((g) => g.space_id === sp.id);
    const materials = d.materials.filter((m) => m.space_id === sp.id);
    const library = c.library && materials.length ? c.library : null;
    // [[slug]] links: an article of this knowledge base is ../slug/, of another one ../../space/slug/.
    // Every page that renders Markdown sits at wiki/<space>/<page>/.
    const links = Object.fromEntries(allArticles.map((a) => [a.slug, { slug: a.slug, title: a.title, href: a.space_id === sp.id ? `../${a.slug}/` : `../../${spaceById.get(a.space_id).slug}/${a.slug}/` }]));
    const glossary = glossaryRows.map((g) => ({ term: g.term, aliases: g.aliases ?? [] }));
    await mkdir(SP, { recursive: true });

    // Left navigation: every section and its articles, with the lifecycle phases in order.
    const sideNav = (current) => {
      const link = (slug, label) => `<li><a href="../${slug}/"${slug === current ? ' aria-current="page"' : ''}>${esc(label.split(': ')[0])}</a></li>`;
      const groups = categories.filter((x) => x.slug !== 'glossary').map((cat) => {
        let items;
        if (c.phases && cat.slug === 'project-lifecycle') {
          const overview = articles.filter((a) => a.category_id === cat.id && a.article_type !== 'phase');
          const phases = articles.filter((a) => a.article_type === 'phase' && a.phase_number).sort((a, b) => a.phase_number - b.phase_number);
          items = overview.map((a) => link(a.slug, a.slug === 'lifecycle-overview' ? 'Overview of the twelve phases' : a.title)).join('')
            + phases.map((a) => `<li><a href="../${a.slug}/"${a.slug === current ? ' aria-current="page"' : ''}><span class="wiki-side-n">${a.phase_number}</span>${esc(a.title.replace(/^Phase \d+: /, ''))}</a></li>`).join('');
        } else {
          items = articles.filter((a) => a.category_id === cat.id && !(c.phases && a.article_type === 'phase')).map((a) => link(a.slug, a.title)).join('');
        }
        if (!items) return '';
        return `<div class="wiki-side-group"><p class="wiki-side-h">${esc(cat.title)}</p><ul>${items}</ul></div>`;
      }).join('');
      const tools = `<div class="wiki-side-group"><p class="wiki-side-h">Reference</p><ul>${library ? link('materials', library.title) : ''}${link('glossary', 'Glossary')}</ul></div>`;
      return `<details class="wiki-side" data-wiki-side open>
        <summary>Browse ${esc(sp.short_title || sp.title)}</summary>
        <nav aria-label="${esc(sp.title)} articles"><a class="wiki-side-home" href="../">${esc(sp.title)}</a>${groups}${tools}</nav>
      </details>`;
    };
    const withSide = (current, inner) => `
    <div class="wiki-layout">
      ${sideNav(current)}
      <div class="wiki-main">${inner}
      </div>
    </div>`;
    const crumbsHtml = (here) => `<nav class="wiki-crumbs" aria-label="Breadcrumb"><a href="../../">Wiki</a> <span>/</span> <a href="../">${esc(sp.short_title || sp.title)}</a>${here ? ` <span>/</span> <span>${esc(here)}</span>` : ''}</nav>`;

    // Knowledge base home
    let lifecycleHtml = '';
    if (c.phases) {
      const phasePages = new Map(articles.filter((a) => a.article_type === 'phase' && a.phase_number).map((a) => [a.phase_number, a]));
      const lifecycle = articles.find((a) => a.slug === 'lifecycle-overview');
      const phases = c.phases.map((name, i) => {
        const a = phasePages.get(i + 1);
        const inner = `<span class="tier">Phase ${i + 1}</span><b>${esc(a?.title ?? name)}</b>`;
        return a ? `<a class="wiki-phase" href="${a.slug}/">${inner}</a>` : `<div class="wiki-phase is-empty">${inner}</div>`;
      }).join('\n        ');
      lifecycleHtml = `
      <h2 id="lifecycle" class="wiki-h2">Project lifecycle</h2>
      ${lifecycle ? `<p class="wiki-intro">Start with the <a href="${lifecycle.slug}/">lifecycle overview</a>, then open any phase.</p>` : ''}
      <div class="wiki-phases">
        ${phases}
      </div>`;
    }
    const sections = categories.filter((x) => x.slug !== 'glossary').map((cat) => {
      const list = articles.filter((a) => a.category_id === cat.id && !(c.phases && a.article_type === 'phase'));
      if (!list.length) return '';
      return `<section class="wiki-card"><h3>${esc(cat.title)}</h3>${cat.description ? `<p>${esc(cat.description)}</p>` : ''}<ul>${list.map((a) => `<li><a href="${a.slug}/">${esc(a.title)}${a.summary ? `<small>${esc(a.summary)}</small>` : ''}</a></li>`).join('')}</ul></section>`;
    }).join('\n        ');
    const intro = sp.intro_md ? renderMarkdown(sp.intro_md, { articles: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, { ...v, href: v.href.replace(/^\.\.\//, '') }])), base: '.' }) : '';
    await writeFile(join(SP, 'index.html'), page({
      up: '../../',
      space: sp,
      title: `${sp.title}, explained — InfraStatera Wiki`,
      description: sp.description || sp.title,
      path: spUrl,
      type: 'website',
      image: c.image,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${sp.title} — InfraStatera Wiki`, description: sp.description || undefined, url: `${SITE}/${spUrl}`, publisher: PUBLISHER, isPartOf: { '@type': 'WebSite', name: 'InfraStatera Wiki', url: `${SITE}/wiki/` } }],
      body: `
    <section class="page-head">
      <p class="tier"><a href="../">Wiki</a> · ${plural(articles.length, 'article')}</p>
      <h1>${esc(sp.title)}, explained</h1>
      ${sp.description ? `<p class="page-head-lead">${esc(sp.description)}</p>` : ''}
    </section>
    <section class="wiki-wrap">
      ${intro ? `<div class="wiki-prose wiki-space-intro">${intro}</div>` : ''}
      ${lifecycleHtml}
      <h2 class="wiki-h2">Browse by section</h2>
      <div class="wiki-grid">
        ${sections}
        ${library ? `<section class="wiki-card"><h3>${esc(library.title)}</h3><p>${plural(materials.length, library.noun.replace(/s$/, ''), library.noun)} and what each one is for.</p><ul><li><a href="materials/">Open the ${esc(library.title.toLowerCase())}</a></li></ul></section>` : ''}
        <section class="wiki-card"><h3>Glossary</h3><p>${plural(glossaryRows.length, 'term')} and abbreviations, each with a plain definition.</p><ul><li><a href="glossary/">Open the glossary</a></li></ul></section>
      </div>
    </section>`,
    }));
    sitemapUrls.push({ loc: spUrl, lastmod: today });

    // Articles
    for (const a of articles) {
      const body = a.body_md.replace(/^\s*#\s+.*\n/, '');
      const html = renderMarkdown(body, { articles: links, glossary, base: '..', assets: '../../../assets/wiki/' });
      const mistakes = a.common_mistakes ? renderMarkdown(a.common_mistakes, { articles: links, base: '..' }) : '';
      const toc = outline(body);
      const href = (x) => links[x.slug].href;
      const chosen = d.links.filter((l) => l.from_article === a.id && byId.has(l.to_article));
      const chosenIds = new Set(chosen.map((l) => l.to_article));
      const related = d.related.filter((r) => r.article_id === a.id && byId.has(r.related_id) && !chosenIds.has(r.related_id)).slice(0, 6).map((r) => byId.get(r.related_id));
      const backlinks = d.links.filter((l) => l.to_article === a.id && byId.has(l.from_article)).map((l) => byId.get(l.from_article));
      const tags = d.article_tags.filter((t) => t.article_id === a.id).map((t) => tagsById.get(t.tag_id)).filter(Boolean);
      const cat = catById.get(a.category_id);
      const side = [
        toc.length > 1 && `<section><p class="tier">On this page</p><ul>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></section>`,
        chosen.length && `<section><p class="tier">Linked articles</p><ul>${chosen.map((l) => `<li>${LINK_LABEL[l.kind] ?? 'See also'}: <a href="${href(byId.get(l.to_article))}">${esc(byId.get(l.to_article).title)}</a></li>`).join('')}</ul></section>`,
        related.length && `<section><p class="tier">Related</p><ul>${related.map((r) => `<li><a href="${href(r)}">${esc(r.title)}</a></li>`).join('')}</ul></section>`,
        backlinks.length && `<section><p class="tier">Linked from</p><ul>${backlinks.map((r) => `<li><a href="${href(r)}">${esc(r.title)}</a></li>`).join('')}</ul></section>`,
        tags.length && `<section><p class="tier">Tags</p><div class="wiki-tags">${tags.map((t) => `<span>${esc(t.label)}</span>`).join('')}</div></section>`,
      ].filter(Boolean).join('\n');
      const meta = [
        c.phases && a.phase_number && `<span>Phase ${a.phase_number}</span>`,
        a.spec_edition && `<span>${esc(a.spec_edition)}</span>`,
        `<span>${a.last_verified ? `Last verified ${fmtDate(a.last_verified)}` : 'Not yet verified against the current edition'}</span>`,
      ].filter(Boolean).join('');
      const path = `${spUrl}${a.slug}/`;
      await mkdir(join(SP, a.slug), { recursive: true });
      await writeFile(join(SP, a.slug, 'index.html'), page({
        up: '../../../',
        space: sp,
        title: `${a.title} — ${sp.short_title || sp.title} — InfraStatera Wiki`,
        description: a.summary || plain(body).slice(0, 155),
        path,
        crumbs: [{ name: a.title, item: `${SITE}/${path}` }],
        image: firstImage(a.body_md) || c.image,
        jsonLd: [{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: a.title,
          description: a.summary || plain(body).slice(0, 155),
          image: `${SITE}/assets/wiki/og/${(firstImage(a.body_md) || c.image).replace(/\.svg$/, '.png')}`,
          datePublished: (a.published_at || a.updated_at || '').slice(0, 10) || undefined,
          dateModified: (a.updated_at || '').slice(0, 10) || undefined,
          author: PUBLISHER,
          publisher: PUBLISHER,
          mainEntityOfPage: `${SITE}/${path}`,
          articleSection: cat?.title,
          about: sp.title,
          keywords: tags.map((t) => t.label).join(', ') || undefined,
          inLanguage: 'en-US',
        }],
        body: withSide(a.slug, `
    <div class="wiki-wrap wiki-article">
      <article class="wiki-prose">
        ${crumbsHtml(cat?.title)}
        <h1>${esc(a.title)}</h1>
        <div class="wiki-meta">${meta}</div>
        ${html}
        ${mistakes ? `<section class="wiki-mistakes"><h2>${esc(c.mistakes)}</h2>${mistakes}</section>` : ''}
      </article>
      ${side ? `<aside class="wiki-aside">${side}</aside>` : ''}
    </div>`),
      }));
      sitemapUrls.push({ loc: path, lastmod: (a.updated_at || today).slice(0, 10) });
      index.push({ t: a.title, s: a.summary || plain(a.body_md).slice(0, 140), u: path.replace(/^wiki\//, ''), k: 'Article', b: sp.slug, x: plain(a.body_md).slice(0, 4000) });
    }

    // Glossary
    const letters = [...new Set(glossaryRows.map((g) => g.term[0].toUpperCase()))];
    const entries = glossaryRows.map((g, i) => {
      const first = i === 0 || glossaryRows[i - 1].term[0].toUpperCase() !== g.term[0].toUpperCase();
      const art = g.article_id && byId.get(g.article_id);
      return `<div${first ? ` id="letter-${g.term[0].toUpperCase()}"` : ''}><dt id="${anchor(g.term)}">${esc(g.term)}${g.expansion ? `<small>${esc(g.expansion)}</small>` : ''}</dt><dd>${esc(g.definition)}${art ? ` <a href="${links[art.slug].href}">Read more</a>` : ''}</dd></div>`;
    }).join('\n');
    await mkdir(join(SP, 'glossary'), { recursive: true });
    await writeFile(join(SP, 'glossary', 'index.html'), page({
      up: '../../../',
      space: sp,
      title: `Glossary — ${sp.short_title || sp.title} — InfraStatera Wiki`,
      description: `Terms and abbreviations used in ${sp.title.toLowerCase()}, each with a plain definition.`,
      path: `${spUrl}glossary/`,
      crumbs: [{ name: 'Glossary', item: `${SITE}/${spUrl}glossary/` }],
      image: c.image,
      jsonLd: [{
        '@context': 'https://schema.org',
        '@type': 'DefinedTermSet',
        name: `${sp.title} glossary`,
        url: `${SITE}/${spUrl}glossary/`,
        hasDefinedTerm: glossaryRows.map((g) => ({ '@type': 'DefinedTerm', name: g.term, alternateName: g.expansion || undefined, description: g.definition, url: `${SITE}/${spUrl}glossary/#${anchor(g.term)}` })),
      }],
      body: withSide('glossary', `
    <div class="wiki-wrap wiki-glossary">
      ${crumbsHtml('Glossary')}
      <h1>Glossary</h1>
      ${glossaryRows.length ? `<div class="wiki-letters">${letters.map((l) => `<a href="#letter-${l}">${l}</a>`).join('')}</div><dl>${entries}</dl>` : '<p class="wiki-empty">No terms yet.</p>'}
    </div>`),
    }));
    sitemapUrls.push({ loc: `${spUrl}glossary/`, lastmod: today });
    for (const g of glossaryRows) index.push({ t: g.expansion ? `${g.term} — ${g.expansion}` : g.term, s: g.definition.slice(0, 140), u: `${sp.slug}/glossary/#${anchor(g.term)}`, k: 'Glossary', b: sp.slug, x: [g.term, g.expansion, g.definition, ...(g.aliases ?? [])].join(' ') });

    // Library (materials, forms, instruments)
    if (library) {
      const phaseSlug = (n) => articles.find((x) => x.article_type === 'phase' && x.phase_number === n)?.slug;
      const cols = library.showPhase ? 5 : 4;
      const matRows = (g) => materials.filter((m) => m.system_group === g).map((m) => {
        const art = m.article_id && byId.get(m.article_id);
        const phase = library.showPhase ? `<td>${m.phase_number ? (phaseSlug(m.phase_number) ? `<a href="../${phaseSlug(m.phase_number)}/">Phase ${m.phase_number}</a>` : `Phase ${m.phase_number}`) : ''}</td>` : '';
        return `<tr id="${anchor(m.name)}" data-group="${g}"><th scope="row">${esc(m.name)}</th><td>${esc(m.function)}</td>${phase}<td>${m.spec_section ? `${library.colPrefix}${esc(m.spec_section)}` : ''}</td><td>${art ? `<a href="${links[art.slug].href}">Read</a>` : ''}</td></tr>`;
      }).join('');
      const groups = library.groups.filter(([g]) => materials.some((m) => m.system_group === g));
      const matSections = groups.map(([g, label, blurb]) => `
      <section class="wiki-mat-group" data-group="${g}">
        <h2 id="${g}" class="wiki-h2">${label} <small>${blurb}</small></h2>
        <div class="wiki-table"><table class="wiki-mat${library.showPhase ? '' : ' no-phase'}" data-cols="${cols}">
          <thead><tr><th scope="col">${esc(library.item)}</th><th scope="col">What it is for</th>${library.showPhase ? '<th scope="col">Phase</th>' : ''}<th scope="col">${esc(library.col)}</th><th scope="col"><span class="sr-only">Article</span></th></tr></thead>
          <tbody>${matRows(g)}</tbody>
        </table></div>
      </section>`).join('');
      await mkdir(join(SP, 'materials'), { recursive: true });
      await writeFile(join(SP, 'materials', 'index.html'), page({
        up: '../../../',
        space: sp,
        title: `${library.title} — ${sp.short_title || sp.title} — InfraStatera Wiki`,
        description: `${plural(materials.length, library.noun.replace(/s$/, ''), library.noun)} in ${sp.title.toLowerCase()} and what each one is for.`,
        path: `${spUrl}materials/`,
        type: 'website',
        image: library.image,
        crumbs: [{ name: library.title, item: `${SITE}/${spUrl}materials/` }],
        jsonLd: [{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${library.title}: ${sp.title}`,
          numberOfItems: materials.length,
          itemListElement: materials.map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.name, description: m.function, url: `${SITE}/${spUrl}materials/#${anchor(m.name)}` })),
        }],
        body: withSide('materials', `
    <div class="wiki-wrap">
      ${crumbsHtml(library.title)}
      <div class="wiki-prose"><h1>${esc(library.title)}</h1></div>
      <p class="wiki-lead">${esc(library.lead)}</p>
      <div class="wiki-mat-tools" data-mat-filter>
        <div class="wiki-chips" role="group" aria-label="Group">
          <button type="button" aria-pressed="true" data-g="all">All ${materials.length}</button>
          ${groups.map(([g, label]) => `<button type="button" aria-pressed="false" data-g="${g}">${label} ${materials.filter((m) => m.system_group === g).length}</button>`).join('')}
        </div>
        <input type="search" aria-label="Filter the ${esc(library.title.toLowerCase())}" placeholder="${esc(library.filter)}">
        <p class="wiki-mat-count" data-mat-count data-noun="${esc(library.noun)}" aria-live="polite"></p>
      </div>
      ${matSections}
      <p class="wiki-empty" data-mat-none hidden>Nothing matches.</p>
    </div>`),
      }));
      sitemapUrls.push({ loc: `${spUrl}materials/`, lastmod: today });
      for (const m of materials) index.push({ t: m.name, s: m.function, u: `${sp.slug}/materials/#${anchor(m.name)}`, k: library.item.split(' ')[0], b: sp.slug, x: [m.name, m.function, m.system_group, m.spec_section].filter(Boolean).join(' ') });
    }

    sp._counts = { articles: articles.length, terms: glossaryRows.length, library: library ? `${plural(materials.length, library.noun.replace(/s$/, ''), library.noun)}` : '' };
    sp._first = categories.flatMap((cat) => articles.filter((a) => a.category_id === cat.id)).slice(0, 3);
    summary.push(`${sp.slug}: ${articles.length} article(s), ${glossaryRows.length} term(s), ${materials.length} library item(s)`);
  }

  // Wiki home: every published knowledge base.
  const cards = spaces.map((sp) => {
    const c = cfg(sp.slug);
    return `<article class="wiki-space">
          <a class="wiki-space-pic" href="${sp.slug}/" tabindex="-1" aria-hidden="true"><img src="../assets/wiki/${c.image}" alt="" loading="lazy"></a>
          <div class="wiki-space-body">
            <h2><a href="${sp.slug}/">${esc(sp.title)}</a></h2>
            ${sp.description ? `<p>${esc(sp.description)}</p>` : ''}
            <p class="wiki-space-count">${[plural(sp._counts.articles, 'article'), sp._counts.library, plural(sp._counts.terms, 'glossary term')].filter(Boolean).join(' · ')}</p>
            ${sp._first.length ? `<ul>${sp._first.map((a) => `<li><a href="${sp.slug}/${a.slug}/">${esc(a.title)}</a></li>`).join('')}</ul>` : ''}
            <a class="btn btn-primary btn-sm" href="${sp.slug}/">Open ${esc(sp.short_title || sp.title)}</a>
          </div>
        </article>`;
  }).join('\n        ');
  await writeFile(join(OUT, 'index.html'), page({
    up: '../',
    title: 'Wiki — practical guides for contractors and inspectors — InfraStatera',
    description: `Free, practical knowledge bases for contractors and engineers on public works: ${spaces.map((s) => s.title.toLowerCase()).join(', ')}.`,
    path: 'wiki/',
    type: 'website',
    image: cfg(spaces[0]?.slug).image,
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'InfraStatera Wiki', url: `${SITE}/wiki/`, publisher: PUBLISHER,
      hasPart: spaces.map((s) => ({ '@type': 'CollectionPage', name: s.title, url: `${SITE}/wiki/${s.slug}/`, description: s.description || undefined })),
    }],
    body: `
    <section class="page-head">
      <p class="tier">Wiki</p>
      <h1>Construction, explained</h1>
      <p class="page-head-lead">Practical knowledge bases written from the job: how the work is actually done, the documents behind it and the words people use. Pick a subject, or search them all at once.</p>
    </section>
    <section class="wiki-wrap">
      <div class="wiki-spaces">
        ${cards}
      </div>
    </section>`,
  }));
  sitemapUrls.unshift({ loc: 'wiki/', lastmod: today });

  // Home page band: one card per published knowledge base, between the wiki-home markers in index.html.
  const homePath = join(ROOT, 'index.html');
  const home = await readFile(homePath, 'utf8');
  const articleTotal = spaces.reduce((n, s) => n + s._counts.articles, 0);
  const homeLead = `<p class="section-lead">Free guides for contractors and inspectors, written from real projects. ${spaces.length} knowledge bases, ${articleTotal} articles, searchable all at once.</p>`;
  const homeCards = `<div class="wiki-home-cards">
${spaces.map((sp) => `          <a class="wiki-home-card" href="wiki/${sp.slug}/">
            <span class="wiki-home-pic"><img src="assets/wiki/${cfg(sp.slug).image}" alt="" loading="lazy"></span>
            <span class="wiki-home-name">${esc(sp.title)}</span>
            <span class="wiki-home-count">${plural(sp._counts.articles, 'article')}</span>
          </a>`).join('\n')}
        </div>`;
  const homeNext = home
    .replace(/(<!-- wiki-home:lead:start[^>]*-->)[\s\S]*?(\s*<!-- wiki-home:lead:end -->)/, `$1\n            ${homeLead}$2`)
    .replace(/(<!-- wiki-home:cards:start[^>]*-->)[\s\S]*?(\s*<!-- wiki-home:cards:end -->)/, `$1\n        ${homeCards}$2`);
  if (homeNext !== home) await writeFile(homePath, homeNext);

  // Old addresses (before several knowledge bases): Caltrans electrical work lived directly under /wiki/.
  const legacy = spaces.find((s) => s.slug === 'caltrans-electrical');
  if (legacy) {
    const old = allArticles.filter((a) => a.space_id === legacy.id).map((a) => a.slug).concat(['glossary', 'materials']);
    for (const slug of old) {
      await mkdir(join(OUT, slug), { recursive: true });
      await writeFile(join(OUT, slug, 'index.html'), moved(`wiki/${legacy.slug}/${slug}/`));
    }
  }

  // Moved articles: a forwarding page at the old address, unless a page is built there again.
  for (const [old, slug] of MOVED_ARTICLES) {
    const a = allArticles.find((x) => x.slug === slug);
    if (!a) continue;
    const to = `wiki/${spaceById.get(a.space_id).slug}/${a.slug}/`;
    if (to === `wiki/${old}/` || existsSync(join(OUT, old, 'index.html'))) continue;
    await mkdir(join(OUT, old), { recursive: true });
    await writeFile(join(OUT, old, 'index.html'), moved(to));
  }

  // Search index for the wiki's search box (read in the browser, nothing else is called).
  // u is relative to /wiki/; b is the knowledge base, shown on hits from another one.
  await writeFile(join(OUT, 'search.json'), JSON.stringify({ spaces: Object.fromEntries(spaces.map((s) => [s.slug, s.short_title || s.title])), items: index }));

  // Sitemap: replace the wiki block
  const sitemapPath = join(ROOT, 'sitemap.xml');
  const sitemap = await readFile(sitemapPath, 'utf8');
  const block = `  <!-- wiki:start (generated by scripts/wiki/build.mjs) -->\n${sitemapUrls.map((u) => `  <url>\n    <loc>${SITE}/${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n')}\n  <!-- wiki:end -->`;
  const next = sitemap.includes('<!-- wiki:start')
    ? sitemap.replace(/ *<!-- wiki:start[\s\S]*?<!-- wiki:end -->/, block)
    : sitemap.replace('</urlset>', `${block}\n</urlset>`);
  // Keep the sitemap's own dates unless something in the wiki changed, so nightly runs don't commit noise.
  const strip = (x) => x.replace(/<lastmod>[^<]*<\/lastmod>/g, '');
  if (strip(next) !== strip(sitemap) || !sitemap.includes('<!-- wiki:start')) await writeFile(sitemapPath, next);

  console.log(`Wiki built.\n  ${summary.join('\n  ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
