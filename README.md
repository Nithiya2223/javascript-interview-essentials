# JavaScript Internals: Interview Revision Guide

For frontend and full-stack developers with 3–5 years of experience. Explains JavaScript internals the way an interviewer asks about them: why it works, what it prints, and how to implement it yourself. Every chapter has diagrams you can redraw on a whiteboard.

**Status: 1 of 24 chapters written.** The PDF in `dist/` contains the written chapters.

## Contents

| # | Chapter | Status | Diagrams |
|---|---|---|---|
| 1 | [Execution Context & Call Stack](chapters/01-execution-context.md) | written | 4 Mermaid |
| 2 | Hoisting & Temporal Dead Zone | planned | |
| 3 | Scope, Lexical Environment & Scope Chain | planned | |
| 4 | Closures | planned | |
| 5 | The this Keyword & Binding Rules | planned | |
| 6 | Prototypes & Prototypal Inheritance | planned | |
| 7 | Event Loop, Task Queues & Microtasks | planned | |
| 8 | Promises Internals | planned | |
| 9 | async/await Internals | planned | |
| 10 | Callbacks, Callback Hell & Inversion of Control | planned | |
| 11 | Currying, Partial Application & Function Composition | planned | |
| 12 | Higher-Order Functions: map, filter, reduce | planned | |
| 13 | Debouncing & Throttling | planned | |
| 14 | Memoization & Pure Functions | planned | |
| 15 | Iterators, Generators & the Iteration Protocols | planned | |
| 16 | Garbage Collection & Memory Management | planned | |
| 17 | Type Coercion, Equality & Number Quirks | planned | |
| 18 | Shallow vs Deep Copy, Immutability & structuredClone | planned | |
| 19 | Modules: CommonJS vs ESM | planned | |
| 20 | Proxy, Reflect, Symbols & Weak References | planned | |
| 21 | Error Handling, Strict Mode & Misc Internals | planned | |
| 22 | Mixed Output-Prediction Puzzles | planned | |
| 23 | Top 30 Machine-Coding & Polyfill Problems | planned | |
| 24 | Last-Day Revision Sheet | planned | |

Each chapter follows one template (definition, core concept, internals, diagrams, code, gotchas, cheat sheet, interview questions). See [templates/chapter-template.md](templates/chapter-template.md).

## Build the PDF

Requires Node.js 18+ and a Chromium. Mermaid, a Markdown parser, fonts and a PDF reader are vendored in `vendor/`, so no npm install is needed when `playwright-core` and a Chromium are already available. Otherwise run `npm install` and set `CHROME_PATH` to a Chromium binary.

```bash
npm run lint       # chapter structure, labelled code fences, ASCII width
npm run samples    # run every JS example and compare with the printed output
npm run diagrams   # render Mermaid blocks to diagrams/*.svg (all chapters, or: node scripts/render-diagrams.js 01)
npm run build      # lint + diagrams + PDF  ->  dist/JavaScript-Internals-Interview-Revision-Guide.pdf
npm run verify     # inspect the PDF (add: -- --preview to write page PNGs to build/preview/)
```

## How diagrams are built

Diagram source stays in the chapter files, inside ````mermaid``` blocks that begin with two comment lines:

```text
%% id: kebab-case-name
%% title: Caption shown under the figure
```

`scripts/render-diagrams.js` renders each block with the Mermaid engine in headless Chromium to `diagrams/chNN-<id>.svg` and exits non-zero, listing file, diagram number and line, if any block fails to parse. `scripts/build-book.js` then swaps each block for an image reference in a build copy of the Markdown, so Mermaid code never reaches the PDF. ASCII diagrams use ````ascii Caption``` fences. Diagrams use greyscale and line styles only.

`@mermaid-js/mermaid-cli` (`mmdc`) could not be installed in the authoring sandbox (the npm registry was blocked), so the renderer drives the same Mermaid library directly. See `vendor/README.md`.

## Repository layout

```text
chapters/    one Markdown file per chapter (source of truth, includes diagram source)
diagrams/    rendered SVGs (generated)
scripts/     lint, sample runner, diagram renderer, PDF builder, PDF verifier
assets/      print stylesheet and the "About" page
templates/   chapter template
vendor/      Mermaid, marked, pdf.js, fonts (committed so the build works offline)
dist/        the compiled PDF
book.json    chapter registry (titles, slugs)
```
