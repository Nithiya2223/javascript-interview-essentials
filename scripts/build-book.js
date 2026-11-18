#!/usr/bin/env node
'use strict';
/**
 * Build the print-ready PDF.
 *
 *   node scripts/build-book.js [--skip-render] [--skip-lint] [--no-pdf]
 *
 * Steps
 *  1. lint chapters (structure, labelled code fences, ASCII width)
 *  2. render every Mermaid block to diagrams/*.svg (scripts/render-diagrams.js)
 *  3. write a build copy of each chapter in which Mermaid blocks are replaced by
 *     image references to the rendered SVG (build/chapters/*.md)
 *  4. Markdown -> HTML (vendor/marked), cover, TOC, list of diagrams
 *  5. DOM checks under print layout: images loaded, nothing wider than the page
 *  6. PDF via Chromium; two-pass so TOC / list-of-diagrams carry real page numbers
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Marked } = require('../vendor/marked.min.js');
const {
  DIRS, BOOK, listChapters, scanFences, extractMermaid, diagramFileName, launchBrowser, slugify,
} = require('./lib/common');
const { openPdf, squash } = require('./lib/pdf-inspect');
const { lintAll } = require('./lint-chapters');

const args = new Set(process.argv.slice(2));
const registry = JSON.parse(fs.readFileSync(path.join(DIRS.root, 'book.json'), 'utf8')).chapters;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const STAR = '<svg class="star" viewBox="0 0 24 24" role="img" aria-label="frequently reported"><polygon points="12,1.5 15.1,8.4 22.5,9.1 16.9,14 18.6,21.4 12,17.6 5.4,21.4 7.1,14 1.5,9.1 8.9,8.4" fill="#000"/></svg>';

// ------------------------------------------------------------ preprocessing

/** Replace mermaid blocks by image refs, number figures, collect metadata. */
function prepareChapter(ch) {
  const md = fs.readFileSync(ch.path, 'utf8');
  const segs = scanFences(md);
  const mermaids = extractMermaid(ch);
  let mi = 0;
  let fig = 0;
  const figures = [];
  const out = [];
  for (const s of segs) {
    if (s.type === 'text') {
      out.push(s.lines.join('\n'));
      continue;
    }
    const first = s.info.split(/\s+/)[0];
    if (first === 'mermaid') {
      const d = mermaids[mi++];
      fig += 1;
      const num = `${ch.num}.${fig}`;
      figures.push({ num, title: d.title, kind: 'mermaid' });
      out.push(`![Figure ${num}: ${d.title}](../diagrams/${diagramFileName(ch, d.id)})`);
    } else if (first === 'ascii') {
      fig += 1;
      const num = `${ch.num}.${fig}`;
      const title = s.info.replace(/^ascii\s*/, '').trim() || 'Diagram';
      figures.push({ num, title, kind: 'ascii' });
      out.push(['```ascii Figure ' + num + ': ' + title, ...s.lines, '```'].join('\n'));
    } else {
      out.push(s.raw.join('\n'));
    }
  }
  return { md: out.join('\n'), figures };
}

// ------------------------------------------------------------ markdown -> html

function renderChapter(ch, md) {
  const headings = [];
  const used = new Map();
  const uid = (text) => {
    const base = `${ch.prefix}-${slugify(text) || 'section'}`.slice(0, 70);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const reg = registry.find((r) => r.num === ch.num);

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = stripTags(inner).replace(/\s+/g, ' ').trim();
        const id = uid(text);
        if (depth === 1) {
          const m = /^Chapter\s+(\d+):\s*(.+)$/.exec(text);
          if (!m) throw new Error(`${ch.file}: H1 must read "# Chapter N: Title"`);
          headings.push({ depth: 1, id, text, keys: [`Chapter ${m[1]}${m[2]}`, `Chapter ${m[1]}: ${m[2]}`], title: m[2], label: `Chapter ${m[1]}` });
          return `<h1 id="${id}"><span class="ch-label">Chapter ${m[1]}</span>${esc(m[2])}</h1>\n`;
        }
        headings.push({ depth, id, text, keys: [text] });
        const cls = depth === 3 && /^Q\d+\.\d+/.test(text) ? ' class="q"' : depth === 2 && /interview questions/i.test(text) ? ' class="questions"' : '';
        return `<h${depth} id="${id}"${cls}>${inner}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        if (tokens.length === 1 && tokens[0].type === 'image') return this.parser.parseInline(tokens);
        const where = tokens[0] && tokens[0].type === 'em' && /^Typically asked in/.test(tokens[0].text || '');
        return `<p${where ? ' class="where"' : ''}>${this.parser.parseInline(tokens)}</p>\n`;
      },
      image({ href, text }) {
        return `<figure class="fig"><img src="${esc(href)}" alt="${esc(text)}"><h6 class="figcap">${esc(text)}</h6></figure>\n`;
      },
      code({ text, lang }) {
        const info = (lang || '').trim();
        const [first, ...rest] = info.split(/\s+/);
        if (!first) throw new Error(`${ch.file}: code fence without a language label`);
        if (first === 'ascii') {
          const cap = rest.join(' ');
          const m = /^Figure\s+[\d.]+:/.exec(cap);
          if (!m) throw new Error(`${ch.file}: ascii fence without caption`);
          return `<figure class="fig ascii-fig"><pre class="ascii"><code>${esc(text)}</code></pre><h6 class="figcap">${esc(cap)}</h6></figure>\n`;
        }
        const lines = text.split('\n').length;
        const isOut = rest[0] === 'output';
        const cls = [lines <= 26 ? 'short' : '', isOut ? 'output' : ''].filter(Boolean).join(' ');
        return `<pre class="${cls}"${isOut ? '' : ` data-lang="${esc(first)}"`}><code>${esc(text)}</code></pre>\n`;
      },
      blockquote({ tokens }) {
        let kind = '';
        let title = '';
        let body = tokens;
        const p = tokens[0];
        if (p && p.type === 'paragraph' && p.tokens[0] && p.tokens[0].type === 'strong') {
          title = stripTags(this.parser.parseInline(p.tokens[0].tokens));
          const rest = p.tokens.slice(1);
          while (rest.length && (rest[0].type === 'br' || (rest[0].type === 'text' && /^\s*$/.test(rest[0].raw)))) rest.shift();
          if (rest.length && rest[0].type === 'text') rest[0] = { ...rest[0], raw: rest[0].raw.replace(/^\s+/, ''), text: (rest[0].text || '').replace(/^\s+/, '') };
          body = rest.length ? [{ type: 'paragraph', raw: '', text: '', tokens: rest }, ...tokens.slice(1)] : tokens.slice(1);
          const t = title.toLowerCase();
          kind = t.startsWith('how to explain') ? 'say'
            : t.startsWith('model answer') ? 'model'
            : /^(trap|gotcha|follow-up)/.test(t) ? 'trap'
            : /^(cheat|quick revision)/.test(t) ? 'cheat' : 'note';
        }
        const inner = this.parser.parse(body);
        return `<blockquote class="${kind}">${title ? `<span class="box-title">${esc(title)}</span>` : ''}${inner}</blockquote>\n`;
      },
    },
  });

  let html = marked.parse(md);
  html = html.split('\u2605').join(STAR);
  return { html, headings, short: reg ? reg.short : '' };
}

// ------------------------------------------------------------ document assembly

function tocRow(title, key, pageMap, cls, id) {
  const pg = pageMap ? pageMap.get(key) : null;
  return `<li class="${cls}"><a class="row" href="#${id}"><span class="t">${esc(title)}</span><span class="dots"></span><span class="pg">${pg == null ? '0' : pg}</span></a></li>`;
}

function assemble(chapters, pageMap) {
  const css = fs.readFileSync(path.join(DIRS.assets, 'book.css'), 'utf8');
  const about = new Marked({ gfm: true }).parse(fs.readFileSync(path.join(DIRS.assets, 'about.md'), 'utf8')).split('\u2605').join(STAR);
  const pageRules = chapters
    .map((c) => `@page ch${String(c.num).padStart(2, '0')} { @top-right { content: "Chapter ${c.num}: ${c.short.replace(/"/g, '')}"; font: 7.5pt "Noto Sans", sans-serif; color: #333; vertical-align: bottom; padding-bottom: 3mm; } }`)
    .join('\n');

  // table of contents
  const written = new Set(chapters.map((c) => c.num));
  const toc = [];
  for (const r of registry) {
    const c = chapters.find((x) => x.num === r.num);
    if (!c) {
      toc.push(`<li class="ch planned"><span class="row"><span class="t">Chapter ${r.num}: ${esc(r.title)} (forthcoming)</span></span></li>`);
      continue;
    }
    const h1 = c.headings.find((h) => h.depth === 1);
    toc.push(tocRow(`Chapter ${r.num}: ${r.title}`, squash(h1.keys[0]), pageMap, 'ch', h1.id));
    for (const h of c.headings.filter((x) => x.depth === 2)) toc.push(tocRow(h.text, squash(h.keys[0]), pageMap, 'sec', h.id));
  }

  // list of diagrams
  const lof = [];
  for (const c of chapters) {
    if (!c.figures.length) continue;
    lof.push(`<li class="chhead">Chapter ${c.num}: ${esc(c.title)}</li>`);
    for (const f of c.figures) {
      const key = squash(`Figure ${f.num}: ${f.title}`);
      lof.push(tocRow(`Figure ${f.num}: ${f.title}`, key, pageMap, 'fig', c.prefix));
    }
  }

  const stack = ['multiply(4, 4)', 'square(4)', 'printSquare(4)', 'Global'];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(BOOK.fullTitle)}</title>
<style>
${css}
${pageRules}
${chapters.map((c) => `.chapter.ch${String(c.num).padStart(2, '0')} { page: ch${String(c.num).padStart(2, '0')}; }`).join('\n')}
</style></head><body>
<section class="cover">
  <div class="band"></div>
  <div class="inner">
    <div class="kicker">Interview Revision Guide</div>
    <h1>${esc(BOOK.title)}</h1>
    <div class="subtitle">${esc(BOOK.subtitle)}</div>
    <p class="audience">${esc(BOOK.audience)}</p>
    <p class="scope">The call stack, closures, prototypes, the event loop, promises, garbage collection and more, explained the way you would say it and sketch it in an interview.</p>
  </div>
  <div class="stack">${stack.map((s) => `<div>${s}</div>`).join('')}</div>
  <div class="foot">Edition ${new Date().toISOString().slice(0, 10)} &middot; ${written.size} of ${registry.length} chapters</div>
</section>
<section class="front about">${about}</section>
<section class="front toc"><h1>Contents</h1><ul>${toc.join('\n')}</ul></section>
<section class="front lof"><h1>List of Diagrams</h1><ul>${lof.join('\n')}</ul></section>
${chapters.map((c) => `<section class="chapter ch${String(c.num).padStart(2, '0')}" id="${c.prefix}">${c.html}</section>`).join('\n')}
</body></html>`;
}

// ------------------------------------------------------------ browser checks + pdf

async function layoutChecks(page) {
  await page.setViewportSize({ width: 657, height: 960 }); // A4 minus 18mm side margins, in CSS px
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  return page.evaluate(() => {
    const problems = [];
    const area = document.querySelector('.chapter, .front');
    const maxRight = area ? area.getBoundingClientRect().right + 1 : 657;
    const maxH = 297 * 3.7795 - (20 + 22) * 3.7795 - 8; // printable page height in px
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (!img.naturalWidth) problems.push(`image failed to load: ${img.getAttribute('src')}`);
      else if (r.right > maxRight) problems.push(`image wider than page: ${img.getAttribute('src')}`);
      else if (r.height > maxH) problems.push(`image taller than page: ${img.getAttribute('src')}`);
    }
    for (const pre of document.querySelectorAll('pre')) {
      if (pre.scrollWidth > pre.clientWidth + 1) {
        const where = pre.closest('figure') ? pre.closest('figure').querySelector('.figcap').textContent : pre.textContent.slice(0, 50).replace(/\n/g, ' ');
        problems.push(`code/ASCII block overflows page width (${pre.scrollWidth}px > ${pre.clientWidth}px): ${where}`);
      }
    }
    for (const pre of document.querySelectorAll('pre.ascii')) {
      const h = pre.getBoundingClientRect().height;
      if (h > maxH) problems.push('ASCII diagram taller than one page: ' + pre.closest('figure').querySelector('.figcap').textContent);
    }
    const raw = document.body.innerText;
    if (/```|^\s*%%\s*(id|title):/m.test(raw)) problems.push('raw ``` fence or Mermaid %% directive visible in page text');
    return problems;
  });
}

async function makePdf(html, htmlPath) {
  fs.writeFileSync(htmlPath, html);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    const problems = await layoutChecks(page);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
    return { pdf, problems };
  } finally {
    await browser.close();
  }
}

async function buildPageMap(pdf, chapters) {
  const doc = await openPdf(pdf);
  try {
    const outline = await doc.outline();
    const map = new Map();
    for (const o of outline) {
      const k = squash(o.title);
      if (o.page != null && !map.has(k)) map.set(k, o.page);
    }
    const pages = await doc.pageCount();
    return { map, pages, outlineSize: outline.length };
  } finally {
    await doc.close();
  }
}

// ------------------------------------------------------------ main

async function main() {
  if (!args.has('--skip-lint')) {
    const { errors, warnings } = lintAll();
    warnings.forEach((w) => console.warn('  lint warning: ' + w));
    if (errors.length) {
      console.error(`\nLINT FAILED (${errors.length}):`);
      errors.forEach((e) => console.error(' - ' + e));
      process.exit(1);
    }
    console.log(`lint ok (${warnings.length} warning(s))`);
  }
  if (!args.has('--skip-render')) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'render-diagrams.js')], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('\nDiagram rendering failed; refusing to build a PDF with missing diagrams.');
      process.exit(1);
    }
  }

  fs.mkdirSync(path.join(DIRS.build, 'chapters'), { recursive: true });
  fs.mkdirSync(DIRS.dist, { recursive: true });
  const chapters = listChapters().map((ch) => {
    const { md, figures } = prepareChapter(ch);
    fs.writeFileSync(path.join(DIRS.build, 'chapters', ch.file), md);
    const r = renderChapter(ch, md);
    const reg = registry.find((x) => x.num === ch.num);
    return { ...ch, figures, ...r, title: reg ? reg.title : ch.file };
  });
  if (!chapters.length) throw new Error('no chapters found');

  const htmlPath = path.join(DIRS.build, 'book.html');
  let pageMap = null;
  let result;
  let prev = '';
  for (let pass = 1; pass <= 4; pass++) {
    result = await makePdf(assemble(chapters, pageMap), htmlPath);
    if (result.problems.length) {
      console.error('\nLAYOUT PROBLEMS:');
      result.problems.forEach((p) => console.error(' - ' + p));
      process.exit(1);
    }
    const { map, pages, outlineSize } = await buildPageMap(result.pdf, chapters);
    const sig = JSON.stringify([...map.entries()]);
    console.log(`pass ${pass}: ${pages} pages, ${outlineSize} outline entries`);
    if (!outlineSize) throw new Error('PDF has no outline; cannot compute page numbers');
    if (sig === prev) break;
    prev = sig;
    pageMap = map;
  }
  const outFile = path.join(DIRS.dist, BOOK.pdfName);
  fs.writeFileSync(outFile, result.pdf);
  console.log(`\nWrote ${path.relative(DIRS.root, outFile)} (${(result.pdf.length / 1024).toFixed(0)} KiB)`);
}

main().catch((e) => {
  console.error('build-book failed:', e);
  process.exit(2);
});
