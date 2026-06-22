# Markdown Workflow

Browser-based academic journal publishing pipeline. Converts DOCX → Markdown → LaTeX → PDF entirely in the browser using WebAssembly (pandoc-wasm + busytex).

## Features

- Upload DOCX/ODT files, auto-convert to Markdown with YAML frontmatter
- Edit Markdown body and YAML metadata in CodeMirror 6
- Generate LaTeX via pandoc-wasm, compile PDF via XeLaTeX (busytex)
- Image/media file management with replace support
- Drag-and-drop article reordering
- Export/import entire issues as ZIP archives
- IndexedDB persistence (no server)

## Setup

```bash
npm install
npm run setup     # downloads TeX Live WASM assets (~400 MB on first run)
npm run dev       # starts dev server at localhost:5173
```

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # preview the production build locally
```

## Deploy

[Netlify](https://www.netlify.com/) — drag `dist/` or connect your repo. A `netlify.toml` is included with SPA fallback and required COOP/COEP headers.

## Tech Stack

- [Vite](https://vitejs.dev/) — build tool
- [CodeMirror 6](https://codemirror.net/) — editor
- [pandoc-wasm](https://github.com/jwokaty/pandoc-wasm) — DOCX → Markdown → LaTeX
- [busytex](https://github.com/texlyre/busytex) — XeLaTeX in WASM
- [JSZip](https://stuk.github.io/jszip/) — ZIP export/import
- [SortableJS](https://sortablejs.github.io/Sortable/) — drag-and-drop
