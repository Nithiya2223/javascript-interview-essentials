#!/usr/bin/env node
'use strict';
/**
 * Verify the finished PDF.
 *
 *   node scripts/verify-pdf.js [--preview]    (--preview also writes PNGs to build/preview/)
 *
 * Checks
 *  1. no raw Mermaid source, ``` fences or "%%" directives anywhere in the PDF text
 *  2. every Mermaid diagram is present: its caption is in the outline and every
 *     text label of its SVG appears in the PDF text of the page that holds it
 *  3. table of contents and list of diagrams carry the real page numbers
 *  4. no ink in the outer page edge strips (nothing cut off or overflowing)
 *  5. the PDF has page numbers (footer text) on every page except the cover
 */
const fs = require('fs');
const path = require('path');
const { DIRS, BOOK, listChapters, extractMermaid, diagramFileName } = require('./lib/common');
const { openPdf, squash } = require('./lib/pdf-inspect');

const preview = process.argv.includes('--preview');
const pdfPath = path.join(DIRS.dist, BOOK.pdfName);

function svgLabels(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const out = [];
  // each <text> element's visible string = concatenation of its tspans (or its own text)
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (t) out.push(t);
  }
  return out;
}

(async () => {
  if (!fs.existsSync(pdfPath)) throw new Error(`missing ${pdfPath}; run the build first`);
  const buf = fs.readFileSync(pdfPath);
  const doc = await openPdf(buf);
  const problems = [];
  const info = [];
  try {
    const n = await doc.pageCount();
    const pages = await doc.allText();
    const outline = await doc.outline();
    info.push(`${n} pages, ${outline.length} outline entries, ${(buf.length / 1024).toFixed(0)} KiB`);

    // 1. forbidden raw source
    const forbidden = [/```/, /\bmermaid\b/i, /\bflowchart\s+(TD|LR|TB|BT|RL)\b/, /\bsequenceDiagram\b/, /\bstateDiagram(-v2)?\b/, /%%\s*(id|title):/, /\bgraph\s+(TD|LR)\b/];
    // Text extraction can split ligatures ("fl owchart"), so also test with whitespace removed.
    const squashedForbidden = [/flowchart(TD|LR|TB|BT|RL)/, /sequenceDiagram/, /stateDiagram/, /%%(id|title):/, /graph(TD|LR)/];
    pages.forEach((t, i) => {
      for (const re of forbidden) if (re.test(t)) problems.push(`page ${i + 1}: raw diagram source text matched ${re}`);
      const sq = t.replace(/\s+/g, ''); // case preserved: prose "sequence diagram" must not match
      for (const re of squashedForbidden) if (re.test(sq)) problems.push(`page ${i + 1}: raw diagram source text matched ${re} (ignoring spaces)`);
    });

    // 2. diagrams present
    const byTitle = new Map();
    for (const o of outline) {
      const k = squash(o.title);
      if (!byTitle.has(k)) byTitle.set(k, o.page);
    }
    let diagrams = 0;
    let labelsChecked = 0;
    for (const ch of listChapters()) {
      let fig = 0;
      const blocks = extractMermaid(ch);
      // figure numbers count mermaid + ascii in document order; recompute by scanning
      const md = fs.readFileSync(ch.path, 'utf8');
      const re = /^```(mermaid|ascii)\b[ \t]*(.*)$/gm;
      let m;
      let mi = 0;
      while ((m = re.exec(md))) {
        fig += 1;
        const num = `${ch.num}.${fig}`;
        let title;
        if (m[1] === 'mermaid') {
          const d = blocks[mi++];
          title = d.title;
          diagrams += 1;
          const file = path.join(DIRS.diagrams, diagramFileName(ch, d.id));
          const page = byTitle.get(squash(`Figure ${num}: ${title}`));
          if (!page) {
            problems.push(`Figure ${num} (${d.id}): caption not found in the PDF outline`);
            continue;
          }
          const text = squash(pages[page - 1]);
          for (const label of svgLabels(file)) {
            labelsChecked += 1;
            if (!text.includes(squash(label))) problems.push(`Figure ${num} (${d.id}) page ${page}: label "${label}" missing from page text`);
          }
        } else if (!byTitle.get(squash(`Figure ${num}: ${m[2].trim()}`))) {
          problems.push(`Figure ${num} (ascii): caption not found in the PDF outline`);
        }
      }
    }
    info.push(`${diagrams} Mermaid diagram(s) found in the PDF; ${labelsChecked} diagram labels matched against page text`);

    // 2b. duplicated words in the text layer (e.g. stroke+fill drawn twice) hurt copy/paste and search
    // A stroke+fill label shows up as consecutive doubled pairs: "let, let, const, const".
    const dupRe = /\b(\S{3,})\s+\1\s+(\S{3,})\s+\2\b/g;
    pages.forEach((t, i) => {
      const hits = [...t.matchAll(dupRe)].map((m) => `${m[1]} ${m[1]} ${m[2]} ${m[2]}`);
      if (hits.length) problems.push(`page ${i + 1}: text layer has doubled words (${hits.slice(0, 3).join(' | ')})`);
    });

    // 3. TOC / list of diagrams page numbers
    const firstChapterPage = Math.min(...outline.filter((o) => /^chapter\d/.test(squash(o.title))).map((o) => o.page));
    const front = squash(pages.slice(1, firstChapterPage - 1).join(' '));
    let tocChecked = 0;
    for (const o of outline) {
      if (!/^(chapter\s*\d|figure\s*\d|\d+\.\d+\s)/i.test(o.title)) continue;
      if (o.page < firstChapterPage) continue;
      // chapter h1 outline titles are "Chapter 1Title"; TOC rows read "Chapter 1: Title"
      let t = o.title.replace(/^chapter\s*(\d+)\s*/i, 'Chapter $1: ');
      tocChecked += 1;
      if (!front.includes(squash(t) + o.page)) problems.push(`TOC/list entry "${t}" does not show page ${o.page}`);
    }
    info.push(`${tocChecked} contents / list-of-diagrams entries carry the correct page number`);

    // 4. edge ink + 5. page numbers
    for (let p = 1; p <= n; p++) {
      const ink = await doc.edgeInk(p);
      if (p === 1) continue; // cover bleeds on purpose
      if (ink.left || ink.right) problems.push(`page ${p}: content reaches the left/right page edge (${ink.left}/${ink.right} dark px)`);
      if (ink.top) problems.push(`page ${p}: content in the top edge strip (${ink.top} px)`);
      if (ink.bottom) problems.push(`page ${p}: content in the bottom edge strip (${ink.bottom} px)`);
      // margin boxes (running header + page number) are emitted first in the text stream
      if (!new RegExp(`\\s${p}\\s`).test(pages[p - 1].slice(0, 150))) problems.push(`page ${p}: page number ${p} not found in the footer`);
    }
    info.push('edge-ink and footer page-number checks run on every page');

    if (preview) {
      const dir = path.join(DIRS.build, 'preview');
      fs.mkdirSync(dir, { recursive: true });
      for (let p = 1; p <= n; p++) await doc.renderPage(p, path.join(dir, `page-${String(p).padStart(2, '0')}.png`), 1.3);
      info.push(`previews written to ${path.relative(DIRS.root, dir)}/`);
    }
  } finally {
    await doc.close();
  }
  info.forEach((l) => console.log('  ' + l));
  if (problems.length) {
    console.error(`\nPDF VERIFICATION FAILED (${problems.length}):`);
    problems.forEach((p) => console.error(' - ' + p));
    process.exit(1);
  }
  console.log('\nPDF verification passed.');
})().catch((e) => {
  console.error('verify-pdf crashed:', e);
  process.exit(2);
});
