'use strict';
/**
 * Read a PDF with pdf.js (vendor/pdfjs) running inside headless Chromium.
 * Used to (a) learn which page each heading/figure landed on, so the table of
 * contents can carry real page numbers, and (b) verify the finished PDF.
 */
const fs = require('fs');
const path = require('path');
const { DIRS, launchBrowser } = require('./common');

async function openPdf(buffer) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><html><body style="margin:0;background:#888"></body></html>');
  const lib = fs.readFileSync(path.join(DIRS.vendor, 'pdfjs', 'pdf.min.js'), 'utf8');
  const worker = fs.readFileSync(path.join(DIRS.vendor, 'pdfjs', 'pdf.worker.min.js'), 'utf8');
  await page.addScriptTag({ content: lib });
  await page.evaluate(async ({ b64, worker }) => {
    const blob = new Blob([worker], { type: 'text/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.__doc = await pdfjsLib.getDocument({ data }).promise;
  }, { b64: buffer.toString('base64'), worker });

  const api = {
    async pageCount() {
      return page.evaluate(() => window.__doc.numPages);
    },
    /** Flattened outline: [{title, depth, page}] with 1-based pages. */
    async outline() {
      return page.evaluate(async () => {
        const doc = window.__doc;
        const out = [];
        async function walk(items, depth) {
          for (const it of items || []) {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            let pg = null;
            if (Array.isArray(dest) && dest[0] && typeof dest[0] === 'object') {
              pg = (await doc.getPageIndex(dest[0])) + 1;
            }
            out.push({ title: it.title, depth, page: pg });
            await walk(it.items, depth + 1);
          }
        }
        await walk(await doc.getOutline(), 0);
        return out;
      });
    },
    /** Text of one page (1-based) with items joined by single spaces. */
    async pageText(n) {
      return page.evaluate(async (n) => {
        const p = await window.__doc.getPage(n);
        const tc = await p.getTextContent();
        return tc.items.map((i) => i.str).join(' ');
      }, n);
    },
    async allText() {
      const n = await api.pageCount();
      const pages = [];
      for (let i = 1; i <= n; i++) pages.push(await api.pageText(i));
      return pages;
    },
    /** Rasterise page n at the given scale to a PNG file; returns {width,height}. */
    async renderPage(n, outFile, scale = 1.4) {
      const dataUrl = await page.evaluate(async ({ n, scale }) => {
        const p = await window.__doc.getPage(n);
        const vp = p.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        return canvas.toDataURL('image/png');
      }, { n, scale });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
    },
    /**
     * Rasterise page n and report dark pixels inside the outer edge strips
     * (left/right 9 mm, top 6 mm, bottom 6 mm). Content must never reach them.
     * Returns counts per edge.
     */
    async edgeInk(n) {
      return page.evaluate(async (n) => {
        const p = await window.__doc.getPage(n);
        const vp = p.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        const mm = vp.width / 210;
        const count = (x, y, w, h) => {
          const d = ctx.getImageData(Math.floor(x), Math.floor(y), Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))).data;
          let c = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 140 && d[i + 3] > 0) c++;
          return c;
        };
        return {
          left: count(0, 0, 9 * mm, canvas.height),
          right: count(canvas.width - 9 * mm, 0, 9 * mm, canvas.height),
          top: count(0, 0, canvas.width, 6 * mm),
          bottom: count(0, canvas.height - 6 * mm, canvas.width, 6 * mm),
          width: canvas.width,
          height: canvas.height,
        };
      }, n);
    },
    async close() {
      await browser.close();
    },
  };
  return api;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
// Case-insensitive on purpose: Chromium's outline keeps CSS text-transform ("CHAPTER 1").
const squash = (s) => String(s).replace(/\s+/g, '').toLowerCase();

module.exports = { openPdf, norm, squash };
