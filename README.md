# InfraStatera — website

Static one-page site for [infrastatera.com](https://infrastatera.com), served by GitHub Pages from the `main` branch (custom domain set in `CNAME`).

## Structure

```
index.html          Homepage: hero, featured demos, services, process, why us, contact
demo/index.html     All demos page (infrastatera.com/demo), built from js/demos.js
js/demos.js         Demo catalog: add new demos here
css/style.css       All styles (Open Sans, showroom layout, responsive)
js/main.js          Mobile menu, dismissible announcement bar, footer year
assets/logo.svg     Brand mark (hexagon + I-beam)
assets/favicon.svg
assets/img/         Hero photo and demo screenshots
```

No build step is needed. To preview locally:

```bash
npx vite        # or: python3 -m http.server 3000
```

## Adding a demo

1. Add screenshots to `assets/img/` (desktop ~800×500, optional phone ~780×1688).
2. Open `js/demos.js`, copy one `{ ... }` block in `INFRASTATERA_DEMOS` and fill it in. The order in the list is the order on the page.
3. The demo appears on [infrastatera.com/demo](https://infrastatera.com/demo/) automatically.

The homepage shows two featured demos as large tiles (hand-written in `index.html`) plus a "See all demos" button. Swap a featured tile there only if you want a new demo on the homepage too.

## Editing

- **Featured demo links** on the homepage live in `index.html` (search for `vercel.app` and `defect-capture-demo`); the full list lives in `js/demos.js`.
- **Colors** are CSS variables at the top of `css/style.css`: `--blue` for buttons and links, `--brand` / `--tier` for the logo red-orange and small labels.
- **Hero photo**: `assets/img/hero-interchange.jpg` — "Aerial Night View of City Highway Interchange" by Raj Manohar on Pexels (free to use).

## SEO

- `sitemap.xml` lists every page. When you add a new page, add a `<url>` entry and update `<lastmod>`.
- `robots.txt` points search engines to the sitemap and hides `/docs/`.
- Structured data (Organization + WebSite) is in the `<head>` of `index.html`. Add the LinkedIn company page URL to a `"sameAs"` list there once it exists.

## Wiki (infrastatera.com/wiki)

`wiki/` is generated: don't edit it by hand. Articles and glossary terms are written and published in the InfraStatera platform database (knowledge base tables), and `scripts/wiki/build.mjs` turns the published ones into pages, a search index (`wiki/search.json`) and the wiki part of `sitemap.xml`.

- The GitHub Action **Update wiki** (`.github/workflows/wiki.yml`) runs it every night and commits only if something changed. After publishing an article, run it right away from the Actions tab → Update wiki → Run workflow.
- The home page's Wiki band (`index.html`, between the `wiki-home` markers) is also generated: one card per published knowledge base, so a new one appears there on the next run.
- Preview from a saved copy of the data: `node scripts/wiki/build.mjs --from data.json`.
- Pictures: put files in `assets/wiki/` and write `![description](file.svg "Caption")` on its own line in an article. The diagrams there are original drawings (not to scale), free to reuse on this site.
- Share images: `scripts/wiki/og-images.sh` turns each illustration into `assets/wiki/og/<name>.png` (1200×630) for LinkedIn and search previews; the action runs it before building. An article uses the image of its first illustration.
- Several knowledge bases (`kb_spaces`): `wiki/` lists the published ones, each is built at `wiki/<space>/` with its own articles, glossary and library (`wiki/<space>/materials/`, from `kb_materials`: materials, forms or equipment). What differs between them (disclaimer, library title and groups, the Caltrans lifecycle) is in `SPACE_CONFIG` in `build.mjs`; a new knowledge base works without an entry.
- Old addresses: Caltrans pages used to live directly under `wiki/`; the build writes small pages there that send visitors to `wiki/caltrans-electrical/...`.
- Styles: `css/wiki.css`. Search box: `js/wiki.js`. The home page links to it from the menu, the Wiki band under the demos and the footer.
