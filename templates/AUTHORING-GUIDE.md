# Authoring guide: JavaScript Internals: Interview Revision Guide

Read this fully, then read `chapters/01-execution-context.md` and `chapters/02-hoisting-tdz.md` end to end. They are the reference for tone, depth, formatting and diagram style. Match them. Also read `templates/chapter-template.md` (conventions are enforced by `npm run lint`).

## Audience and goal

Frontend / full-stack developers with 3 to 5 years of experience. They use JavaScript daily; skip beginner definitions. The book helps them **explain internals confidently in interviews**: "why/how it works under the hood", output-prediction puzzles, implement-it-yourself problems, and diagrams they can sketch on a whiteboard. Concise, technically precise, no filler, no marketing tone.

## Files you may touch

- Write only the chapter file(s) assigned to you in `chapters/`. Never edit other chapters, scripts, assets, `book.json` or `README.md`. If you find a tooling bug, report it in your final message instead of fixing it.
- Do NOT run `scripts/build-book.js`, `scripts/verify-pdf.js`, `scripts/build-readme.js`, or any `git` command. Other authors are working in parallel and those commands touch shared output.
- Scratch files go in `.cache/` (gitignored). Never leave stray files elsewhere.

## Mandatory chapter structure (the linter enforces this)

`# Chapter N: Title` then exactly eight `##` sections, numbered `N.1` to `N.8`:

1. `## N.1 Definition and why interviewers ask it`  (one-line definition in bold, then why asked, in which round, "(commonly reported)")
2. `## N.2 Core concept` (`### Plain language` with an analogy where it helps, then `### Precise version` with the technical explanation, spec terms, tables)
3. `## N.3 How it works internally` (numbered step-by-step walkthrough of what the engine does; mention V8 specifics only when you are sure)
4. `## N.4 Diagrams` (each diagram under its own `###` heading, each followed by a "How to explain this to the interviewer" box)
5. `## N.5 Code examples` (small, runnable, commented; each with its output block and a **Why:** line)
6. `## N.6 Common mistakes and gotchas` (bullets)
7. `## N.7 Quick revision cheat sheet` (5 to 8 bullets)
8. `## N.8 Interview questions` (10 to 15 questions, see below)

Headings of questions: `### QN.k ★ Difficulty: Question text` (★ optional, difficulty one of Easy, Medium, Hard). Numbering is sequential across the groups. Groups are `####` headings named exactly: `#### Conceptual`, `#### Output prediction`, `#### Implement it yourself`, `#### Follow-up traps`. End with `#### Sources and further reading`.

Every question has: a `*Typically asked in: ...*` line, a `> **Model answer**` box (spoken answer, about 80 to 140 words, 30 to 60 seconds aloud, first person, no code dump), and a `**Key points to mention**` bullet list. If a question is best answered by drawing, say so and reference the figure ("Draw it: Figure N.k"). Output-prediction questions: the code, a `text output` block, the model answer explaining step by step, and a small trace diagram (Mermaid sequence/flowchart or ASCII) wherever order of execution matters. Implement-it-yourself: problem statement, full solution code that actually runs, a `text output` demo, edge cases and complexity in the key points.

Mix of the 10 to 15 questions: roughly 4 to 6 conceptual, 4 to 6 output prediction, 1 to 3 implement-it-yourself, 2 to 3 follow-up traps. Prefer questions that recur across public interview write-ups. Mark only genuinely staple questions with ★.

## Honesty rules for sources and frequency (important)

- **Never fabricate** company names, quotes, statistics, round names that you cannot support, or URLs. Write `(commonly reported)` when you cannot pin a question to a source. Name a round type (JavaScript fundamentals round, machine-coding round, managerial/design round) rather than a company. Only name a company if a source you actually opened says so, and then cite it.
- You have `remote_web_search` (and `web_fetch`; note tc39.es and ecma-international.org return 403). Use a few searches per chapter to confirm that your questions are recurring ones (GeeksforGeeks, dev.to, Medium, Reddit, GitHub interview repos, Glassdoor-type posts), and cite those URLs you actually saw in the "Sources and further reading" list. Never invent a URL. Safe canonical references: `https://tc39.es/ecma262/`, MDN paths you are sure of, `https://javascript.info/...`, `https://v8.dev/blog/...`, Jake Archibald's "In The Loop" talk and "Tasks, microtasks, queues and schedules" article (jakearchibald.com), Kyle Simpson's *You Don't Know JS Yet*.
- Technical claims must be correct. If a behaviour differs between browsers and Node.js, or between sloppy and strict mode, say so. If you are not sure of a spec detail, test it in Node or leave it out. Do not state V8 internals you cannot support.

## Code samples

- Every `js` fence is executed by `node scripts/verify-samples.js NN` and its stdout must equal the next fence, labelled ```` ```text output ````. Run it until it passes.
- Make examples deterministic. Do not print timings, random values, object addresses or stack paths. Catch errors and print `e.name + ': ' + e.message`.
- ```` ```js script ```` runs as a classic global script (top-level `var` becomes a global property). ```` ```js norun ```` is display-only (browser/DOM code, never-terminating code, multi-file examples). Use `norun` sparingly; prefer runnable code.
- `setTimeout(..., 0)` versus `setImmediate` order is nondeterministic in the main module: avoid asserting it. `process.nextTick`, promise and `queueMicrotask` ordering is deterministic and fine.
- Keep code lines at most 92 characters (they must fit the page without wrapping). Use 2-space indentation.

## Diagrams: rules and lessons learned (read carefully)

Two kinds, both kept in the chapter file:

1. **Mermaid** for flowcharts, sequence diagrams, state diagrams. Each block must start with:
   ```text
   %% id: kebab-name
   %% title: Caption shown under the figure
   ```
   Ids are unique within the chapter. Render and validate with `node scripts/render-diagrams.js NN`; it exits non-zero and names the file, diagram number and line on any syntax error. Fix all errors.
2. **ASCII** ("```ascii Caption") for memory layouts, stacks, chains, timelines, tables. Plain ASCII only (`+ - | > v < ^ =`), at most 84 columns. Lint enforces the width.

Hard-won rules:

- **Look at every Mermaid diagram.** After rendering run `node scripts/preview-svg.js .cache/chNN.png diagrams/chNN-<id>.svg ...` and open the PNG with `read_file`. The tool warns when a diagram is wider than 657px, because the printed page is about 657px wide and wider diagrams are shrunk (text becomes too small). Target width of 800px or less and height of 900px or less. Redesign (fewer nodes, shorter labels, `flowchart LR` versus `TD`, fewer branches) rather than accepting a huge diagram.
- Keep labels short; use `<br/>` for line breaks. Labels must not begin with `1.`, `-` or `*` (Mermaid treats them as list markup and may drop the text). Do not use `subgraph` with long titles (titles collide with edges); use a `[["subroutine node"]]` containing the grouped steps instead.
- Avoid wide fan-outs (more than three siblings on one rank). Avoid diagrams with more than about 12 nodes. Prefer two small diagrams to one large one.
- Quote labels: `A["text (with) punctuation"]`. Avoid `"` inside labels and avoid `<` `>` except `<br/>`.
- Sequence diagrams: use short participant aliases and short messages (about 35 characters). Use `Note over X: ...` for what is logged.
- State diagrams: no self-transitions (they render as odd loops); use `direction LR`; put line breaks in labels with `<br/>`.
- Diagrams must work in black and white: use words and line styles (dashed `-.->`, thick `==>`), never colour alone. Do not use `style`/`classDef` colours.
- Do not add decorative diagrams. Each one must help explain something to an interviewer.
- Every figure in section N.4 is followed by a blockquote that starts exactly `> **How to explain this to the interviewer**` and then a numbered list of 3 short steps (what to draw first, what to point at) and a final `> **Takeaway:** one sentence.` The linter checks this. A figure whose caption starts with "Whiteboard version" is exempt.
- "Whiteboard version" figures are a minimal ASCII sketch (about 6 boxes or arrows at most) that a candidate can draw in under 2 minutes.
- Figure numbers are assigned automatically in document order, counting Mermaid and ASCII figures together (Figure N.1, N.2, ...). When your text says "Figure N.k", count carefully, and re-check after you add or remove a figure. The PDF's list of diagrams is built from the captions.

## Per-topic diagram requirements (from the book brief)

Apply to the chapter that covers the topic:

- Call stack / execution context: stack-frame push/pop for a sample snippet (done in Ch 1).
- Hoisting / scope / closures: scope chain and lexical environment diagram: what each environment record holds, and where a closure keeps its reference.
- `this`: a decision flowchart ("how was the function called?" to resulting `this`).
- Prototypes: a prototype chain diagram, plus a step-by-step diagram of what `new` does.
- Event loop: a full flow diagram (call stack, Web APIs, macrotask queue, microtask queue, render step, loop tick) AND a sequence diagram tracing one output-prediction snippet tick by tick.
- Promises / async-await: a state diagram (pending to fulfilled/rejected), a chaining flow, and a timeline showing where `await` suspends and resumes.
- Currying / composition: a data-flow diagram showing how arguments accumulate across calls.
- Debounce / throttle: a timeline comparing the event stream with function invocations.
- Garbage collection: a reachability graph (mark-and-sweep) and a generational heap diagram.
- Type coercion: a flowchart for how `==` and `+` decide the conversion.
- Modules: a dependency / circular-import diagram and CJS vs ESM loading phases.
- Any other chapter: add a diagram wherever it makes the explanation clearer.
- **Whiteboard version** (minimal ASCII sketch, under 2 minutes) is required in Chapters 3, 4, 5, 6, 7, 8, 16 (and Chapter 1, already done). Optional elsewhere.

## Tooling you should use before finishing

```bash
node scripts/lint-chapters.js NN        # structure, headings, question groups, fence labels, ASCII width, figure boxes
node scripts/verify-samples.js NN       # runs every js example; compares with the `text output` block
node scripts/render-diagrams.js NN      # renders Mermaid to diagrams/chNN-*.svg; reports syntax errors
node scripts/preview-svg.js .cache/chNN.png diagrams/chNN-<id>.svg ...   # then read_file the PNG and LOOK
```

All four must be clean. `lint` must report 0 errors and 0 warnings.

## Writing style

Concise, precise, plain language. Active voice. No filler, no "Great question", no hype, no em-dash chains (use commas and periods). British or American spelling is fine but be consistent with Chapters 1 and 2 (they use British: "initialised", "uninitialised"). Name each concept with one consistent term. Say what the engine does and why. Use tables where they compress information. Keep analogies short and only where they clarify.

## Final message to the coordinator

Report briefly: chapter file(s) written, counts (figures, questions, samples), any claim you were unsure about, any tooling problem, and the list of sources you actually opened. Do not paste the chapter back.
