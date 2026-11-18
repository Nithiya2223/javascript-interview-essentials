'use strict';
/**
 * Shared helpers for the book build scripts.
 * Node >= 18, no npm dependencies. Browser automation uses playwright-core
 * (found automatically, see resolvePlaywright) driving a local Chromium.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = {
  root: ROOT,
  chapters: path.join(ROOT, 'chapters'),
  diagrams: path.join(ROOT, 'diagrams'),
  build: path.join(ROOT, 'build'),
  dist: path.join(ROOT, 'dist'),
  vendor: path.join(ROOT, 'vendor'),
  assets: path.join(ROOT, 'assets'),
};

const BOOK = {
  title: 'JavaScript Internals',
  subtitle: 'Interview Revision Guide',
  fullTitle: 'JavaScript Internals: Interview Revision Guide',
  audience: 'For frontend and full-stack developers with 3\u20135 years of experience',
  pdfName: 'JavaScript-Internals-Interview-Revision-Guide.pdf',
};

/** Chapter files look like 01-execution-context.md, 22-mixed-puzzles.md ... */
function listChapters() {
  if (!fs.existsSync(DIRS.chapters)) return [];
  return fs
    .readdirSync(DIRS.chapters)
    .filter((f) => /^\d{2}-[a-z0-9-]+\.md$/.test(f))
    .sort()
    .map((file) => ({
      file,
      num: parseInt(file.slice(0, 2), 10),
      prefix: 'ch' + file.slice(0, 2),
      path: path.join(DIRS.chapters, file),
    }));
}

/**
 * Split Markdown into fenced blocks and prose using a line scanner, so a
 * "```mermaid" inside another fenced block is never mistaken for a diagram.
 * Returns segments: {type:'text'|'fence', lines, info, startLine}
 */
function scanFences(md) {
  const lines = md.split('\n');
  const segs = [];
  let buf = [];
  let bufStart = 1;
  let fence = null; // {marker, info, start, lines}
  const flush = () => {
    if (buf.length) segs.push({ type: 'text', lines: buf, startLine: bufStart });
    buf = [];
  };
  lines.forEach((line, i) => {
    const ln = i + 1;
    if (!fence) {
      const m = /^(\s{0,3})(`{3,}|~{3,})\s*(.*)$/.exec(line);
      if (m) {
        flush();
        fence = { marker: m[2], info: m[3].trim(), startLine: ln, lines: [], raw: [line] };
      } else {
        if (!buf.length) bufStart = ln;
        buf.push(line);
      }
    } else {
      const closeRe = new RegExp('^\\s{0,3}' + fence.marker[0] + '{' + fence.marker.length + ',}\\s*$');
      if (closeRe.test(line)) {
        fence.raw.push(line);
        segs.push({ type: 'fence', info: fence.info, lines: fence.lines, raw: fence.raw, startLine: fence.startLine });
        fence = null;
        bufStart = ln + 1;
      } else {
        fence.lines.push(line);
        fence.raw.push(line);
      }
    }
  });
  if (fence) {
    throw new Error(`Unclosed code fence opened at line ${fence.startLine}`);
  }
  flush();
  return segs;
}

/**
 * Extract Mermaid diagrams from a chapter. Each block must start with
 *   %% id: kebab-case-name
 *   %% title: Human readable caption
 */
function extractMermaid(chapter) {
  const md = fs.readFileSync(chapter.path, 'utf8');
  const segs = scanFences(md);
  const out = [];
  let n = 0;
  for (const s of segs) {
    if (s.type !== 'fence' || s.info.split(/\s+/)[0] !== 'mermaid') continue;
    n += 1;
    const src = s.lines.join('\n');
    const id = /^\s*%%\s*id:\s*([a-z0-9-]+)\s*$/m.exec(src);
    const title = /^\s*%%\s*title:\s*(.+?)\s*$/m.exec(src);
    out.push({
      chapter,
      index: n,
      line: s.startLine,
      src,
      raw: s.raw.join('\n'),
      id: id ? id[1] : null,
      title: title ? title[1] : null,
    });
  }
  return out;
}

function diagramFileName(chapter, id) {
  return `${chapter.prefix}-${id}.svg`;
}

// ---------------------------------------------------------------- browser

function tryRequire(p) {
  try {
    return require(p);
  } catch (e) {
    return null;
  }
}

/** Find playwright-core: local install, PLAYWRIGHT_CORE_PATH, or any global npm root. */
function resolvePlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE_PATH) candidates.push(process.env.PLAYWRIGHT_CORE_PATH);
  candidates.push('playwright-core', 'playwright');
  let globalRoot = '';
  try {
    globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    /* ignore */
  }
  if (globalRoot) {
    candidates.push(
      path.join(globalRoot, 'playwright-core'),
      path.join(globalRoot, 'playwright'),
      path.join(globalRoot, '@playwright', 'mcp', 'node_modules', 'playwright-core'),
      path.join(globalRoot, 'agent-browser', 'node_modules', 'playwright-core')
    );
  }
  for (const c of candidates) {
    const m = tryRequire(c);
    if (m && m.chromium) return m;
  }
  throw new Error(
    'playwright-core not found. Install it (npm i -D playwright-core) or set PLAYWRIGHT_CORE_PATH.'
  );
}

/** Find a Chromium binary: CHROME_PATH, headless shell/chrome under known roots. */
function resolveChrome(pw) {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/inner_container/opt/playwright', '/opt/playwright',
    path.join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).sort().reverse()) {
      const shell = path.join(r, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (d.startsWith('chromium_headless_shell') && fs.existsSync(shell)) return shell;
    }
    for (const d of fs.readdirSync(r).sort().reverse()) {
      const chrome = path.join(r, d, 'chrome-linux64', 'chrome');
      if (d.startsWith('chromium-') && fs.existsSync(chrome)) return chrome;
    }
  }
  try {
    const p = pw.chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {
    /* ignore */
  }
  throw new Error('No Chromium found. Set CHROME_PATH to a Chromium/Chrome/headless-shell binary.');
}

/**
 * Launch Chromium. --no-sandbox and --disable-crash-reporter are required in the
 * authoring sandbox (the full chrome binary dies on its crashpad handler there;
 * the headless shell works).
 */
async function launchBrowser() {
  const pw = resolvePlaywright();
  const executablePath = resolveChrome(pw);
  return pw.chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-crash-reporter', '--disable-gpu', '--allow-file-access-from-files'],
  });
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

module.exports = {
  ROOT, DIRS, BOOK,
  listChapters, scanFences, extractMermaid, diagramFileName,
  launchBrowser, resolvePlaywright, resolveChrome, slugify,
};
