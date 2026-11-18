# Vendored third-party files

These files are committed so the book builds without npm access (the authoring
sandbox blocks the npm registry). Replace them with npm packages if you prefer.

| File | What | Version | Licence |
|---|---|---|---|
| `mermaid.min.js` | Mermaid diagram engine (same engine `mmdc` uses) | 11.9.0 | MIT (`mermaid.LICENSE.txt`) |
| `marked.min.js` | Markdown to HTML | 15.0.7 | MIT |
| `pdfjs/pdf.min.js`, `pdfjs/pdf.worker.min.js` | PDF reader used only by `scripts/verify-pdf.js` | 3.2.146 | Apache-2.0 (`pdfjs/LICENSE.txt`) |
| `fonts/SourceCodePro-*.ttf` | Monospace font for code and ASCII diagrams | - | SIL OFL 1.1 |
| `fonts/NotoSans-*VF.ttf` | Body font | - | SIL OFL 1.1 |
