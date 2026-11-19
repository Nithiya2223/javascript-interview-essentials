#!/usr/bin/env node
'use strict';
/**
 * Structural lint for chapters. Enforces the book's fixed chapter template so
 * every chapter is built the same way.
 *
 *   node scripts/lint-chapters.js [01 07 ...]
 */
const fs = require('fs');
const path = require('path');
const { DIRS, listChapters, scanFences } = require('./lib/common');

const SECTION_PATTERNS = [
  /definition/i, // 1. one-line definition and why interviewers ask it
  /core concept/i,
  /internal|under the hood/i,
  /diagram/i,
  /code example/i,
  /mistake|gotcha/i,
  /cheat sheet|revision/i,
  /interview questions/i,
];
const GROUPS = [/^conceptual/i, /^output prediction/i, /^implement it yourself/i, /^follow-up traps/i];
const KNOWN_LANGS = new Set(['js', 'javascript', 'ts', 'text', 'bash', 'json', 'html', 'css', 'ascii', 'mermaid']);
const MAX_ASCII = 84;
const MAX_CODE = 92;

function lintChapter(ch) {
  const errors = [];
  const warnings = [];
  const rel = path.relative(DIRS.root, ch.path);
  const err = (line, msg) => errors.push(`${rel}:${line}: ${msg}`);
  const warn = (line, msg) => warnings.push(`${rel}:${line}: ${msg}`);

  const md = fs.readFileSync(ch.path, 'utf8');
  let segs;
  try {
    segs = scanFences(md);
  } catch (e) {
    err(1, e.message);
    return { errors, warnings };
  }

  // flat event list in document order
  const events = [];
  for (const s of segs) {
    if (s.type === 'fence') {
      const [lang, ...rest] = s.info.split(/\s+/);
      events.push({ kind: 'fence', lang, rest: rest.join(' '), info: s.info, lines: s.lines, line: s.startLine });
    } else {
      s.lines.forEach((l, i) => events.push({ kind: 'text', text: l, line: s.startLine + i }));
    }
  }

  // ---- fences
  for (const e of events.filter((x) => x.kind === 'fence')) {
    if (e.info.includes('`')) err(e.line, 'fence info string contains a backtick (CommonMark rejects it, so the block would not render as code); remove backticks from the caption');
    if (!e.lang) err(e.line, 'code fence without a language label');
    else if (!KNOWN_LANGS.has(e.lang)) warn(e.line, `unusual fence language "${e.lang}"`);
    if (e.lang === 'ascii' && !e.rest) err(e.line, 'ascii diagram needs a caption: ```ascii Caption text');
    const max = e.lang === 'ascii' ? MAX_ASCII : MAX_CODE;
    e.lines.forEach((l, i) => {
      if (e.lang === 'mermaid') return;
      if (l.length > max) (e.lang === 'ascii' ? err : warn)(e.line + 1 + i, `line is ${l.length} chars (max ${max}) and may overflow the page`);
    });
    if (e.lang === 'mermaid') {
      const src = e.lines.join('\n');
      if (!/^\s*%%\s*id:\s*[a-z0-9-]+\s*$/m.test(src)) err(e.line, 'mermaid block needs "%% id: kebab-name"');
      if (!/^\s*%%\s*title:\s*\S/m.test(src)) err(e.line, 'mermaid block needs "%% title: caption"');
    }
  }

  // ---- headings
  const h = events.filter((e) => e.kind === 'text').map((e) => ({ ...e, m: /^(#{1,6})\s+(.*)$/.exec(e.text) })).filter((e) => e.m)
    .map((e) => ({ depth: e.m[1].length, text: e.m[2].trim(), line: e.line }));
  const h1 = h.filter((x) => x.depth === 1);
  if (h1.length !== 1) err(1, `expected exactly one H1, found ${h1.length}`);
  else {
    const m = /^Chapter\s+(\d+):\s+\S/.exec(h1[0].text);
    if (!m) err(h1[0].line, 'H1 must read "# Chapter N: Title"');
    else if (parseInt(m[1], 10) !== ch.num) err(h1[0].line, `H1 says chapter ${m[1]} but file is ${ch.num}`);
  }

  if (ch.num === 22) {
    const qs = h.filter((x) => x.depth === 3 && /^Q22\.\d+/.test(x.text));
    if (qs.length < 20) err(1, `chapter 22 needs at least 20 puzzles headed "### Q22.n ...", found ${qs.length}`);
    qs.forEach((q, i) => { if (!new RegExp('^Q22\\.' + (i + 1) + '\\b').test(q.text)) err(q.line, `puzzle numbering must be sequential (expected Q22.${i + 1})`); });
  }
  if (ch.num === 23) {
    const ps = h.filter((x) => x.depth === 3 && /^P23\.\d+/.test(x.text));
    if (ps.length !== 30) err(1, `chapter 23 needs exactly 30 problems headed "### P23.n ...", found ${ps.length}`);
    ps.forEach((q, i) => {
      if (!new RegExp('^P23\\.' + (i + 1) + '\\b').test(q.text)) err(q.line, `problem numbering must be sequential (expected P23.${i + 1})`);
      const end = i + 1 < ps.length ? ps[i + 1].line : Infinity;
      const figs = events.filter((e) => e.kind === 'fence' && e.lang === 'mermaid' && e.line > q.line && e.line < end);
      if (figs.length < 1) err(q.line, `${q.text.split(' ')[0]}: each problem needs a Mermaid flowchart of the algorithm`);
    });
  }
  if (ch.num > 21) return { errors, warnings }; // chapters 22-24 have their own layout

  // ---- the 8 required sections, in order
  const h2 = h.filter((x) => x.depth === 2);
  if (h2.length !== 8) err(1, `expected 8 H2 sections (the fixed chapter template), found ${h2.length}`);
  SECTION_PATTERNS.forEach((re, i) => {
    const sec = h2[i];
    if (!sec) return;
    const want = `${ch.num}.${i + 1}`;
    if (!sec.text.startsWith(want + ' ')) err(sec.line, `section ${i + 1} must be numbered "${want} ..." (got "${sec.text}")`);
    if (!re.test(sec.text)) err(sec.line, `section ${i + 1} title should match ${re} (got "${sec.text}")`);
  });

  // ---- section 4: every figure is followed by a "How to explain" box
  const s4 = h2[3];
  const s5 = h2[4];
  if (s4 && s5) {
    let pending = null;
    for (const e of events) {
      if (e.line <= s4.line || e.line >= s5.line) continue;
      const isFig = e.kind === 'fence' && (e.lang === 'mermaid' || e.lang === 'ascii');
      const say = e.kind === 'text' && /^>\s*\*\*How to explain this to the interviewer\*\*/.test(e.text);
      if (isFig || say || (e.kind === 'text' && /^#{3,6}\s/.test(e.text))) {
        if (pending && !say) err(pending.line, `diagram "${pending.title}" has no "How to explain this to the interviewer" box before the next figure/heading`);
        pending = null;
      }
      if (isFig) {
        const title = e.lang === 'ascii' ? e.rest : (/%%\s*title:\s*(.+)/.exec(e.lines.join('\n')) || [, '?'])[1];
        if (!/^whiteboard/i.test(title)) pending = { line: e.line, title };
      }
    }
    if (pending) err(pending.line, `diagram "${pending.title}" has no "How to explain this to the interviewer" box`);
    const figs = events.filter((e) => e.kind === 'fence' && (e.lang === 'mermaid' || e.lang === 'ascii') && e.line > s4.line && e.line < s5.line);
    if (!figs.length) err(s4.line, 'section 4 has no diagrams');
  }

  // ---- questions
  const sQ = h2[7];
  if (sQ) {
    const inQ = h.filter((x) => x.line > sQ.line);
    const qs = inQ.filter((x) => x.depth === 3);
    if (qs.length < 10 || qs.length > 15) err(sQ.line, `interview section needs 10-15 questions, found ${qs.length}`);
    qs.forEach((q, i) => {
      const m = /^Q(\d+)\.(\d+)\b/.exec(q.text);
      if (!m || parseInt(m[1], 10) !== ch.num || parseInt(m[2], 10) !== i + 1) err(q.line, `question heading must start "Q${ch.num}.${i + 1}" (got "${q.text}")`);
      if (!/\b(Easy|Medium|Hard)\b/.test(q.text)) err(q.line, 'question heading must carry a difficulty (Easy/Medium/Hard)');
    });
    const groups = inQ.filter((x) => x.depth === 4).map((x) => x.text);
    GROUPS.forEach((re) => {
      if (!groups.some((g) => re.test(g))) err(sQ.line, `missing question group matching ${re}`);
    });
    // each question has a model answer and key points
    const lines = md.split('\n');
    qs.forEach((q, i) => {
      const end = i + 1 < qs.length ? qs[i + 1].line : lines.length + 1;
      const body = lines.slice(q.line, end - 1).join('\n');
      if (!/\*\*Model answer/i.test(body)) err(q.line, `${q.text.split(' ')[0]}: missing "**Model answer**" box`);
      if (!/\*\*Key points/i.test(body)) err(q.line, `${q.text.split(' ')[0]}: missing "**Key points**"`);
    });
  }
  return { errors, warnings };
}

function lintAll(filter = []) {
  const errors = [];
  const warnings = [];
  for (const ch of listChapters()) {
    if (filter.length && !filter.includes(ch.prefix.slice(2))) continue;
    const r = lintChapter(ch);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings };
}

module.exports = { lintAll, lintChapter };

if (require.main === module) {
  const filter = process.argv.slice(2).map((a) => a.padStart(2, '0'));
  const { errors, warnings } = lintAll(filter);
  warnings.forEach((w) => console.warn('warning: ' + w));
  errors.forEach((e) => console.error('error:   ' + e));
  console.log(`\nlint: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
