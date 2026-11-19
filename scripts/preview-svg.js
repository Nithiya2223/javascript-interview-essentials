#!/usr/bin/env node
'use strict';
/**
 * Screenshot one or more rendered diagrams at print-like scale so you can LOOK at them.
 *   node scripts/preview-svg.js out.png diagrams/ch07-event-loop-flow.svg [more.svg ...]
 * Images are shown at their natural pixel size on a 657px-wide page (the A4 text width),
 * so anything wider than 657px will be scaled down in the printed book: keep diagrams narrow.
 */
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./lib/common');
(async () => {
  const [, , out, ...files] = process.argv;
  if (!out || !files.length) { console.error('usage: preview-svg.js out.png a.svg [b.svg ...]'); process.exit(1); }
  const b = await launchBrowser();
  const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 657, height: 600 } });
  const html = '<body style="margin:0;background:#fff;width:657px">' + files.map((f) => {
    const w = (/width="(\d+)"/.exec(fs.readFileSync(f, 'utf8')) || [])[1] || 0;
    const note = w > 657 ? `<div style="font:11px sans-serif;color:#b00">${path.basename(f)} is ${w}px wide: will be scaled to 657px (${Math.round(65700 / w)}%)</div>` : '';
    return `${note}<img src="file://${path.resolve(f)}" style="max-width:657px;border:1px solid #ccc;margin:6px 0;display:block">`;
  }).join('') + '</body>';
  const tmp = path.join(path.dirname(path.resolve(out)), '.preview.html');
  fs.writeFileSync(tmp, html);
  await p.goto('file://' + tmp);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, fullPage: true });
  fs.unlinkSync(tmp);
  await b.close();
})();
