#!/usr/bin/env node
'use strict';
/**
 * Pre-render every ```mermaid block in chapters/*.md to diagrams/<chNN>-<id>.svg.
 *
 *   node scripts/render-diagrams.js            # all chapters
 *   node scripts/render-diagrams.js 01 07      # only chapters 01 and 07
 *
 * Engine: Mermaid (vendor/mermaid.min.js, the library @mermaid-js/mermaid-cli
 * wraps) running inside headless Chromium. Equivalent to `mmdc -i x.mmd -o x.svg`
 * but needs no npm install. Exits 1 and lists file + diagram number for every
 * diagram that fails to parse or render.
 *
 * Each Mermaid block must begin with:
 *   %% id: kebab-case-name
 *   %% title: Caption shown under the figure
 */
const fs = require('fs');
const path = require('path');
const { DIRS, listChapters, extractMermaid, diagramFileName, launchBrowser } = require('./lib/common');

const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  // Same font that the PDF uses, so measured label widths match printed text.
  fontFamily: '"Noto Sans", "Helvetica Neue", Arial, sans-serif',
  htmlLabels: false,
  flowchart: { htmlLabels: false, wrappingWidth: 420, useMaxWidth: false, curve: 'linear', padding: 10, nodeSpacing: 40, rankSpacing: 45 },
  sequence: {
    useMaxWidth: false, mirrorActors: false, showSequenceNumbers: false, messageMargin: 30, actorMargin: 30, wrap: false,
    messageFontSize: 14, actorFontSize: 14, noteFontSize: 14,
  },
  state: { useMaxWidth: false },
  // White halo behind edge/transition labels so lines never strike through text
  // (SVG text labels have no background box).
  themeCSS:
    '.edgeLabel text, .edgeLabel tspan, .transition-label text, .messageText, .labelText' +
    '{paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round;}',
  // Greyscale only: diagrams must read in black-and-white print.
  themeVariables: {
    background: '#ffffff',
    fontSize: '14px',
    primaryColor: '#ffffff', primaryTextColor: '#000000', primaryBorderColor: '#000000',
    secondaryColor: '#eeeeee', secondaryTextColor: '#000000', secondaryBorderColor: '#000000',
    tertiaryColor: '#f6f6f6', tertiaryTextColor: '#000000', tertiaryBorderColor: '#000000',
    lineColor: '#000000', textColor: '#000000', mainBkg: '#ffffff', nodeBorder: '#000000',
    clusterBkg: '#f6f6f6', clusterBorder: '#000000', edgeLabelBackground: '#ffffff', titleColor: '#000000',
    noteBkgColor: '#eeeeee', noteTextColor: '#000000', noteBorderColor: '#000000',
    actorBkg: '#ffffff', actorBorder: '#000000', actorTextColor: '#000000', actorLineColor: '#000000',
    signalColor: '#000000', signalTextColor: '#000000',
    labelBoxBkgColor: '#eeeeee', labelBoxBorderColor: '#000000', labelTextColor: '#000000', loopTextColor: '#000000',
    activationBkgColor: '#dddddd', activationBorderColor: '#000000',
    sequenceNumberColor: '#ffffff',
    // state diagrams
    stateBkg: '#ffffff', stateLabelColor: '#000000', altBackground: '#eeeeee', compositeBackground: '#f6f6f6',
    compositeBorder: '#000000', compositeTitleBackground: '#eeeeee', transitionColor: '#000000', transitionLabelColor: '#000000',
    specialStateColor: '#000000', innerEndBackground: '#000000',
  },
};

function normaliseSvg(svg) {
  const m = /<svg\b[^>]*>/.exec(svg);
  if (!m) throw new Error('renderer returned no <svg> root');
  let root = m[0];
  const vb = /viewBox="([-\d.\s]+)"/.exec(root);
  if (!vb) throw new Error('svg has no viewBox');
  const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
  root = root
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/\sstyle="[^"]*"/, '')
    .replace('<svg', `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" style="background-color:#ffffff"`);
  if (!/xmlns:xlink=/.test(root)) root = root.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + root + svg.slice(m.index + m[0].length);
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => /^\d{1,2}$/.test(a)).map((a) => a.padStart(2, '0'));
  const chapters = listChapters().filter((c) => !filter.length || filter.includes(c.prefix.slice(2)));
  if (!chapters.length) {
    console.log('No chapters to process.');
    return;
  }
  fs.mkdirSync(DIRS.diagrams, { recursive: true });

  const failures = [];
  const jobs = [];
  for (const ch of chapters) {
    const blocks = extractMermaid(ch);
    const seen = new Set();
    for (const b of blocks) {
      const where = `${path.relative(DIRS.root, ch.path)} diagram #${b.index} (line ${b.line})`;
      if (!b.id) failures.push(`${where}: missing "%% id: <kebab-name>" line`);
      else if (seen.has(b.id)) failures.push(`${where}: duplicate id "${b.id}" in chapter`);
      else seen.add(b.id);
      if (!b.title) failures.push(`${where}: missing "%% title: <caption>" line`);
      if (b.id && b.title) jobs.push({ ...b, where });
    }
    // remove stale svgs for this chapter
    const keep = new Set(blocks.filter((b) => b.id).map((b) => diagramFileName(ch, b.id)));
    for (const f of fs.readdirSync(DIRS.diagrams)) {
      if (f.startsWith(ch.prefix + '-') && f.endsWith('.svg') && !keep.has(f)) {
        fs.unlinkSync(path.join(DIRS.diagrams, f));
        console.log(`  removed stale ${f}`);
      }
    }
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await page.addScriptTag({ path: path.join(DIRS.vendor, 'mermaid.min.js') });
  const ok = await page.evaluate((cfg) => {
    const m = (window.mermaid && (window.mermaid.default || window.mermaid)) ||
      (window.__esbuild_esm_mermaid_nm && window.__esbuild_esm_mermaid_nm.mermaid.default);
    if (!m) return false;
    window.__mm = m;
    m.initialize(cfg);
    return true;
  }, MERMAID_CONFIG);
  if (!ok) throw new Error('Mermaid global not found after loading vendor/mermaid.min.js');

  let rendered = 0;
  for (const job of jobs) {
    const file = diagramFileName(job.chapter, job.id);
    const res = await page.evaluate(async ({ src, id }) => {
      try {
        await window.__mm.parse(src);
        const { svg } = await window.__mm.render('mm-' + id, src);
        return { svg };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    }, { src: job.src, id: job.id });
    if (res.error) {
      failures.push(`${job.where} [${job.id}]: ${res.error.split('\n').slice(0, 6).join('\n      ')}`);
      continue;
    }
    if (/Syntax error in text|mermaid version/i.test(res.svg) && /error-icon|error-text/.test(res.svg)) {
      failures.push(`${job.where} [${job.id}]: renderer produced its error graphic`);
      continue;
    }
    let svg;
    try {
      svg = normaliseSvg(res.svg);
    } catch (e) {
      failures.push(`${job.where} [${job.id}]: ${e.message}`);
      continue;
    }
    if (svg.includes('<foreignObject')) console.log(`  note: ${file} uses foreignObject (HTML labels)`);
    fs.writeFileSync(path.join(DIRS.diagrams, file), svg);
    rendered += 1;
    const dim = /width="(\d+)" height="(\d+)"/.exec(svg);
    console.log(`  ok  ${file}  ${dim ? dim[1] + 'x' + dim[2] : ''}`);
  }
  await browser.close();

  console.log(`\nRendered ${rendered}/${jobs.length} diagram(s) from ${chapters.length} chapter(s).`);
  if (failures.length) {
    console.error(`\nFAILED: ${failures.length} problem(s)`);
    failures.forEach((f) => console.error(' - ' + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('render-diagrams crashed:', e);
  process.exit(2);
});
