#!/usr/bin/env node
'use strict';
/** Regenerate README.md (index + table of contents with chapter status). */
const fs = require('fs');
const path = require('path');
const { DIRS, BOOK, listChapters, extractMermaid } = require('./lib/common');

const reg = JSON.parse(fs.readFileSync(path.join(DIRS.root, 'book.json'), 'utf8')).chapters;
const have = new Map(listChapters().map((c) => [c.num, c]));
const done = reg.filter((r) => have.has(r.num)).length;

const rows = reg.map((r) => {
  const c = have.get(r.num);
  if (!c) return `| ${r.num} | ${r.title} | planned | |`;
  const d = extractMermaid(c).length;
  return `| ${r.num} | [${r.title}](chapters/${c.file}) | written | ${d} Mermaid |`;
});

const md = `# ${BOOK.fullTitle}

${BOOK.audience}. Explains JavaScript internals the way an interviewer asks about them: why it works, what it prints, and how to implement it yourself. Every chapter has diagrams you can redraw on a whiteboard.

**Status: ${done} of ${reg.length} chapters written.** The PDF in \`dist/\` contains the written chapters.

## Contents

| # | Chapter | Status | Diagrams |
|---|---|---|---|
${rows.join('\n')}

Each chapter follows one template (definition, core concept, internals, diagrams, code, gotchas, cheat sheet, interview questions). See [templates/chapter-template.md](templates/chapter-template.md).

## Build the PDF

Requires Node.js 18+ and a Chromium. Mermaid, a Markdown parser, fonts and a PDF reader are vendored in \`vendor/\`, so no npm install is needed when \`playwright-core\` and a Chromium are already available. Otherwise run \`npm install\` and set \`CHROME_PATH\` to a Chromium binary.

\`\`\`bash
npm run lint       # chapter structure, labelled code fences, ASCII width
npm run samples    # run every JS example and compare with the printed output
npm run diagrams   # render Mermaid blocks to diagrams/*.svg (all chapters, or: node scripts/render-diagrams.js 01)
npm run build      # lint + diagrams + PDF  ->  dist/${BOOK.pdfName}
npm run verify     # inspect the PDF (add: -- --preview to write page PNGs to build/preview/)
\`\`\`

## How diagrams are built

Diagram source stays in the chapter files, inside \`\`\`\`mermaid\`\`\` blocks that begin with two comment lines:

\`\`\`text
%% id: kebab-case-name
%% title: Caption shown under the figure
\`\`\`

\`scripts/render-diagrams.js\` renders each block with the Mermaid engine in headless Chromium to \`diagrams/chNN-<id>.svg\` and exits non-zero, listing file, diagram number and line, if any block fails to parse. \`scripts/build-book.js\` then swaps each block for an image reference in a build copy of the Markdown, so Mermaid code never reaches the PDF. ASCII diagrams use \`\`\`\`ascii Caption\`\`\` fences. Diagrams use greyscale and line styles only.

\`@mermaid-js/mermaid-cli\` (\`mmdc\`) could not be installed in the authoring sandbox (the npm registry was blocked), so the renderer drives the same Mermaid library directly. See \`vendor/README.md\`.

## Repository layout

\`\`\`text
chapters/    one Markdown file per chapter (source of truth, includes diagram source)
diagrams/    rendered SVGs (generated)
scripts/     lint, sample runner, diagram renderer, PDF builder, PDF verifier
assets/      print stylesheet and the "About" page
templates/   chapter template
vendor/      Mermaid, marked, pdf.js, fonts (committed so the build works offline)
dist/        the compiled PDF
book.json    chapter registry (titles, slugs)
\`\`\`
`;
fs.writeFileSync(path.join(DIRS.root, 'README.md'), md);
console.log(`README.md written (${done}/${reg.length} chapters)`);
