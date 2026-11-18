#!/usr/bin/env node
'use strict';
/**
 * Execute every runnable JavaScript example and compare its stdout with the
 * "text output" block that follows it, so printed outputs are real, not guessed.
 *
 *   node scripts/verify-samples.js [01 02 ...]
 *
 * Fence conventions
 *   ```js            run as a CommonJS file with `node`
 *   ```js script     run as a classic global script (vm.runInThisContext), so
 *                    top-level `var`/function declarations hit the global object
 *   ```js norun      display only (needs a browser, runs forever, nondeterministic)
 * The expected output is the next fence if it is labelled `text output`.
 * A js block with no following output block is run only to check that it does
 * not throw (unless norun).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DIRS, listChapters, scanFences } = require('./lib/common');

function run(code, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsb-'));
  const file = path.join(dir, 'sample.js');
  let src = code;
  if (mode === 'script') {
    fs.writeFileSync(path.join(dir, 'code.js'), code);
    src = `const vm=require('vm'),fs=require('fs');vm.runInThisContext(fs.readFileSync(${JSON.stringify(path.join(dir, 'code.js'))},'utf8'));`;
  }
  fs.writeFileSync(file, src);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

const norm = (s) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

function main() {
  const filter = process.argv.slice(2).map((a) => a.padStart(2, '0'));
  let ran = 0;
  let compared = 0;
  const failures = [];
  for (const ch of listChapters()) {
    if (filter.length && !filter.includes(ch.prefix.slice(2))) continue;
    const segs = scanFences(fs.readFileSync(ch.path, 'utf8'));
    const fences = segs.filter((s) => s.type === 'fence');
    fences.forEach((f, i) => {
      const [lang, flag] = f.info.split(/\s+/);
      if (!['js', 'javascript'].includes(lang) || flag === 'norun') return;
      const next = fences[i + 1];
      const expectsOutput = Boolean(next && /^text\s+output\b/.test(next.info) && isAdjacent(segs, f, next));
      const r = run(f.lines.join('\n'), flag === 'script' ? 'script' : 'cjs');
      ran += 1;
      const where = `${path.relative(DIRS.root, ch.path)}:${f.startLine}`;
      if (r.status !== 0 && !(expectsOutput && /Uncaught|Error/.test(next.lines.join('\n')))) {
        failures.push(`${where}: exited with ${r.status}\n${(r.stderr || '').split('\n').slice(0, 6).join('\n')}`);
        return;
      }
      if (expectsOutput) {
        compared += 1;
        const got = norm(r.stdout);
        const want = norm(next.lines.join('\n'));
        if (got !== want) failures.push(`${where}: output differs\n--- expected (in book)\n${want}\n--- actual (node ${process.version})\n${got}`);
      }
    });
  }
  console.log(`ran ${ran} example(s), compared ${compared} output block(s) on node ${process.version}`);
  if (failures.length) {
    console.error(`\n${failures.length} FAILURE(S):`);
    failures.forEach((f) => console.error('\n * ' + f));
    process.exit(1);
  }
}

/** true when `next` is the very next segment after `f`, separated only by blank text */
function isAdjacent(segs, f, next) {
  const i = segs.indexOf(f);
  const j = segs.indexOf(next);
  if (j === i + 1) return true;
  if (j === i + 2 && segs[i + 1].type === 'text' && segs[i + 1].lines.every((l) => l.trim() === '')) return true;
  return false;
}

main();
