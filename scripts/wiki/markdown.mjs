// Wiki Markdown → HTML. Same rules as the platform's renderer (src/lib/kb/markdown.ts in
// infrastatera-platform): everything is escaped first, [[slug]] links to a published article
// (anything else shows as "coming soon"), glossary terms link on their first use.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => (/^(https?:\/\/|\/|#)/i.test(u) ? u : null);
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const anchor = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export { esc };

/**
 * @param {string} md
 * @param {{ articles: Record<string, {slug: string, title: string}>, glossary?: {term: string, aliases?: string[]}[], base: string, assets?: string }} opts
 *   base: where the wiki lives, e.g. "/wiki"; assets: where its pictures live, e.g. "../../assets/wiki/"
 */
export function renderMarkdown(md, opts) {
  const linked = new Set();
  // Terms match on their first use, ignoring case and a plural "s"; abbreviations (OTDR, RE) must match exactly,
  // so "re" inside a sentence never links.
  const terms = (opts.glossary ?? [])
    .flatMap((t) => [t.term, ...(t.aliases ?? [])].map((w) => ({ word: w, term: t.term, exact: /^[A-Z0-9]+$/.test(w) })))
    .filter((t) => t.word.trim().length > 1)
    .sort((a, b) => b.word.length - a.word.length);
  const termRe = terms.length ? new RegExp(`(?<![\\w-])(${terms.map((t) => reEscape(t.word)).join('|')})(e?s)?(?![\\w-])`, 'gi') : null;

  const glossaryIn = (text) => {
    if (!termRe) return text;
    return text.replace(termRe, (all, w) => {
      const t = terms.find((x) => (x.exact ? x.word === w : x.word.toLowerCase() === w.toLowerCase()));
      if (!t || linked.has(t.term)) return all;
      linked.add(t.term);
      return `<a class="wiki-term" href="${opts.base}/glossary/#${anchor(t.term)}">${all}</a>`;
    });
  };

  const inline = (raw) => {
    const parts = [];
    const keep = (html) => `\u0000${parts.push(html) - 1}\u0000`;
    let s = raw
      .replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`))
      .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]*))?\]\]/g, (_, slug, label) => {
        const a = opts.articles[slug];
        const text = esc(label?.trim() || a?.title || slug.replace(/-/g, ' '));
        return keep(a ? `<a class="wiki-link" href="${opts.base}/${slug}/">${text}</a>` : `<span class="wiki-link-missing" title="Coming soon">${text}</span>`);
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
        const u = safeUrl(url);
        return keep(u ? `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' rel="noopener" target="_blank"' : ''}>${esc(text)}</a>` : esc(text));
      });
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.split(/(\u0000\d+\u0000|<[^>]+>)/).map((seg) => (seg.startsWith('\u0000') || seg.startsWith('<') ? seg : glossaryIn(seg))).join('');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)]);
  };

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const listRe = /^\s*([-*]|\d+\.)\s+/;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      html.push(`<h${level} id="${anchor(text)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(line);
    if (img) {
      const [, alt, src, caption] = img;
      // Relative paths are files in assets/wiki/ of this site; full addresses are allowed as they are.
      const url = /^https?:\/\//i.test(src) ? src : /^[\w./-]+$/.test(src) && !src.includes('..') ? `${opts.assets ?? ''}${src}` : null;
      if (url) html.push(`<figure class="wiki-figure"><img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote><p>${inline(body.join(' '))}</p></blockquote>`);
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      html.push(`<div class="wiki-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const list = listRe.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) {
        let item = lines[i++].replace(listRe, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listRe.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*([-*]|\d+\.)\s+|\s*(---|\*\*\*)\s*$)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++].trim());
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}

export function outline(md) {
  return [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => ({ id: anchor(m[1].trim()), text: m[1].trim().replace(/[*`]/g, '') }));
}

/** Plain text for search snippets and meta descriptions. */
export function plain(md) {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[\[([a-z0-9-]+)(?:\|([^\]]*))?\]\]/g, (_, s, l) => l || s.replace(/-/g, ' ')).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#>*`|_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
