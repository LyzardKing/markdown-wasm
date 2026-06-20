/**
 * pipeline.js — DOCX→Markdown and Markdown→LaTeX→PDF conversion pipeline
 *
 * Stage 1: DOCX (or ODT) → Markdown
 *   Uses pandoc-wasm (legacy API, mirrors the fulltext-markdown.sh invocation)
 *
 * Stage 2: Markdown + YAML metadata → LaTeX (.tex)
 *   Uses pandoc-wasm with the custom journal templates (mirrors markdown-galleys.sh)
 *
 * Stage 3: LaTeX → PDF
 *   Uses texlyre-busytex XeLaTeX (runs entirely in-browser)
 */

import journalYaml  from './templates/journal.yaml?raw'
import abstractLua  from './templates/abstract-section.lua?raw'
import articleLatex from './templates/article.latex?raw'

// ── Lazy-loaded WASM modules ─────────────────────────────────────────────────
// Both are imported lazily to avoid loading multi-MB WASM on page start.

let _pandocLoaded = false
let pandocConvert = null
let pandocModern = null

async function ensurePandoc() {
  if (_pandocLoaded) return
  const mod = await import('pandoc-wasm')
  pandocConvert = mod.pandoc     // legacy API
  pandocModern  = mod.convert    // modern API
  _pandocLoaded = true
}

// fontawesome5 & academicons — fetched once from /core/busytex/extras/, injected
// at the project root so kpathsea finds them via `.` in TEXINPUTS/OPENTYPEFONTS.
// academicons uses `file:` prefix (patched in its .sty) so fontspec loads by file
// path rather than font-family name, matching how \UnicodeFontFile works for fa5.
const ICON_FILES = [
  // fontawesome5
  { src: 'tex/fontawesome5.sty',                 dst: 'fontawesome5.sty' },
  { src: 'tex/fontawesome5-utex-helper.sty',     dst: 'fontawesome5-utex-helper.sty' },
  { src: 'tex/fontawesome5-mapping.def',         dst: 'fontawesome5-mapping.def' },
  { src: 'tex/tufontawesomefree.fd',             dst: 'tufontawesomefree.fd' },
  { src: 'tex/tufontawesomebrands.fd',           dst: 'tufontawesomebrands.fd' },
  { src: 'tex/ufontawesomefree0.fd',             dst: 'ufontawesomefree0.fd' },
  { src: 'tex/ufontawesomefree1.fd',             dst: 'ufontawesomefree1.fd' },
  { src: 'tex/ufontawesomefree2.fd',             dst: 'ufontawesomefree2.fd' },
  { src: 'tex/ufontawesomefree3.fd',             dst: 'ufontawesomefree3.fd' },
  { src: 'tex/ufontawesomebrands0.fd',           dst: 'ufontawesomebrands0.fd' },
  { src: 'tex/ufontawesomebrands1.fd',           dst: 'ufontawesomebrands1.fd' },
  { src: 'tex/fontawesome5.lua',                 dst: 'fontawesome5.lua' },
  { src: 'opentype/FontAwesome5Free-Regular-400.otf', dst: 'FontAwesome5Free-Regular-400.otf' },
  { src: 'opentype/FontAwesome5Free-Solid-900.otf',   dst: 'FontAwesome5Free-Solid-900.otf' },
  { src: 'opentype/FontAwesome5Brands-Regular-400.otf', dst: 'FontAwesome5Brands-Regular-400.otf' },
  // academicons
  { src: 'tex/academicons.sty',                  dst: 'academicons.sty' },
  { src: 'tex/academicons-xeluatex.tex',         dst: 'academicons-xeluatex.tex' },
  { src: 'tex/academicons-generic.tex',          dst: 'academicons-generic.tex' },
  { src: 'tex/tuacademicons.fd',                 dst: 'tuacademicons.fd' },
  { src: 'tex/uacademicons.fd',                  dst: 'uacademicons.fd' },
  { src: 'truetype/academicons.ttf',             dst: 'academicons.ttf' },
  { src: 'opentype/academicons.otf',             dst: 'academicons.otf' },
]
let _iconFiles = null
async function getIconPackages() {
  if (_iconFiles) return _iconFiles
  const BASE = new URL('/core/busytex/extras/', window.location.href).href
  _iconFiles = await Promise.all(
    ICON_FILES.map(async ({ src, dst }) => {
      const buf = await (await fetch(`${BASE}${src}`)).arrayBuffer()
      return { path: dst, contents: new Uint8Array(buf) }
    })
  )
  return _iconFiles
}

// ── BusyTeX worker state ──────────────────────────────────────────────────────
// Uses the original busytex worker directly (no npm wrapper).
// Assets are served from /core/busytex/ (downloaded via `npm run setup`).

// TeX Gyre Termes OTFs — fetched once from /core/busytex/fonts/, injected
// into every XeLaTeX compile so fontspec can find them with Path=./
const TERMES_FONTS = [
  'texgyretermes-regular.otf',
  'texgyretermes-bold.otf',
  'texgyretermes-italic.otf',
  'texgyretermes-bolditalic.otf',
]
let _termesFiles = null
async function getTermesFiles() {
  if (_termesFiles) return _termesFiles
  const BASE = new URL('/core/busytex/fonts/', window.location.href).href
  _termesFiles = await Promise.all(
    TERMES_FONTS.map(async name => {
      const buf = await (await fetch(`${BASE}${name}`)).arrayBuffer()
      return { path: `fonts/${name}`, contents: new Uint8Array(buf) }
    })
  )
  return _termesFiles
}

let _busytexWorker = null
let _busytexInitResolve = null
let _busytexInitReject = null

// Callbacks set per-compilation; cleared when compile response arrives.
let _compilePending = null  // { onLog, resolve, reject }

function _createBusytexWorker() {
  const BASE = new URL('/core/busytex/', window.location.href).href
  const worker = new Worker(`${BASE}busytex_worker.js`)

  worker.onmessage = ({ data }) => {
    if (data.initialized !== undefined) {
      // Init handshake complete
      const res = _busytexInitResolve
      _busytexInitResolve = null
      _busytexInitReject  = null
      res?.()
    } else if (data.print) {
      _compilePending?.onLog?.(String(data.print))
    } else if (data.pdf !== undefined) {
      const p = _compilePending
      _compilePending = null
      p?.resolve(data)
    } else if (data.exception) {
      if (_compilePending) {
        const p = _compilePending
        _compilePending = null
        p.reject(new Error(data.exception))
      } else {
        // Exception during init
        const rej = _busytexInitReject
        _busytexInitResolve = null
        _busytexInitReject  = null
        rej?.(new Error(data.exception))
      }
    }
  }

  worker.onerror = (e) => {
    const msg = e.message ?? 'Unknown worker error'
    if (_busytexInitReject) {
      const rej = _busytexInitReject
      _busytexInitResolve = null
      _busytexInitReject  = null
      rej(new Error(msg))
    } else if (_compilePending) {
      const p = _compilePending
      _compilePending = null
      p.reject(new Error(msg))
    }
  }

  return worker
}

async function ensureBusytex() {
  if (_busytexWorker) return _busytexWorker

  const BASE = new URL('/core/busytex/', window.location.href).href

  const initPromise = new Promise((resolve, reject) => {
    _busytexInitResolve = resolve
    _busytexInitReject  = reject
  })

  _busytexWorker = _createBusytexWorker()

  const initTimeout = setTimeout(() => {
    const rej = _busytexInitReject
    _busytexInitResolve = null
    _busytexInitReject  = null
    _busytexWorker      = null
    rej?.(new Error('BusyTeX worker initialisation timed out (120s)'))
  }, 120_000)

  _busytexWorker.postMessage({
    busytex_js:              `${BASE}busytex.js`,
    busytex_wasm:            `${BASE}busytex.wasm`,
    preload_data_packages_js: [
      `${BASE}ubuntu-texlive-latex-recommended.js`,
      `${BASE}ubuntu-texlive-latex-extra.js`,
    ],
    // data_packages_js: full catalog for the package resolver
    // NOTE: texlive-extra.js is deliberately omitted — it bundles TeX Live system files
    // (format, binary) from a different build and would corrupt the XeTeX format.
    // fontawesome5 and academicons are injected as local files instead.
    data_packages_js: [
      `${BASE}texlive-basic.js`,
      `${BASE}ubuntu-texlive-latex-recommended.js`,
      `${BASE}ubuntu-texlive-latex-extra.js`,
    ],
    texmf_local: [],
    preload: true,
  })

  try {
    await initPromise
  } catch (err) {
    clearTimeout(initTimeout)
    _busytexWorker = null
    throw err
  }
  clearTimeout(initTimeout)
  return _busytexWorker
}

// ── Stage 1: DOCX → Markdown ──────────────────────────────────────────────────

/**
 * Pre-initialise BusyTeX in the background so the first PDF compilation
 * doesn't need to load the TeX Live data on demand.
 * Call this at app startup; safe to call multiple times (no-op if already done).
 */
export async function warmupBusytex() {
  await ensureBusytex()
}

/**
 * Convert a DOCX/ODT File object to Markdown.
 *
 * Returns { markdown: string, mediaFiles: Map<string, Blob> }
 */

export async function convertDocxToMarkdown(file, onLog) {
  await ensurePandoc()
  onLog?.(`Converting ${file.name} with pandoc…`)

  const fileBlob = new Blob([await file.arrayBuffer()], { type: file.type })

  // Use the modern API: binary input files go in the files object, not stdin.
  const options = {
    from: 'docx',
    to: 'markdown-simple_tables-multiline_tables-grid_tables',
    'input-files': ['input.docx'],
    wrap: 'none',
    'markdown-headings': 'atx',
    standalone: true,
    'extract-media': 'media',
  }

  const files = { 'input.docx': fileBlob }

  let result
  try {
    result = await pandocModern(options, null, files)
  } catch (err) {
    throw new Error(`pandoc conversion failed: ${err.message}`)
  }

  if (result.stderr) {
    console.warn('[pandoc stderr]', result.stderr)
    onLog?.(`pandoc: ${result.stderr.slice(0, 120)}`)
  }

  const markdown = result.stdout ?? ''
  console.log('[convertDocxToMarkdown] stdout length:', markdown.length, '| warnings:', result.warnings?.length ?? 0)
  console.log('[convertDocxToMarkdown] files keys:', Object.keys(result.files ?? {}))

  // Collect extracted media files (images etc.) from result.mediaFiles
  const mediaFilesMap = new Map()
  for (const [path, blob] of Object.entries(result.mediaFiles ?? {})) {
    mediaFilesMap.set(path, blob instanceof Blob ? blob : new Blob([blob]))
  }

  onLog?.(`Done. markdown length: ${markdown.length}, extracted ${mediaFilesMap.size} media file(s).`)

  return { markdown, mediaFiles: mediaFilesMap }
}

// ── Stage 2: Markdown → LaTeX (.tex) ─────────────────────────────────────────

/**
 * Convert Markdown + YAML frontmatter to a LaTeX string.
 *
 * @param {string} markdownWithFrontmatter  Full markdown including YAML header
 * @param {string} issueYaml                Issue-level YAML (volume, issue, year…)
 * @param {{ filename: string, contents: string|Blob }[]} extraFiles  Media files
 * @param {function} onLog
 * @returns {Promise<string>} LaTeX source
 */
export async function convertMarkdownToLatex(markdownWithFrontmatter, issueYaml, extraFiles, onLog) {
  await ensurePandoc()
  onLog?.('Generating LaTeX via pandoc…')

  // Merge metadata: pandoc processes YAML blocks in document order.
  // issueYaml is built without --- delimiters, so wrap it in one.
  const fullInput = `${journalYaml}\n---\n${issueYaml}\n---\n\n${markdownWithFrontmatter}`

  const options = {
    from: 'markdown',
    to: 'latex',
    wrap: 'none',
    'number-sections': true,
    toc: true,
    citeproc: true,
    filters: ['abstract-section.lua'],
    template: 'article.latex',
    standalone: true,
  }

  const files = {
    'abstract-section.lua': abstractLua,
    'article.latex': articleLatex,
  }
  // Add media resources
  for (const r of extraFiles) {
    files[r.filename] = r.contents
  }

  let result
  try {
    result = await pandocModern(options, fullInput, files)
  } catch (err) {
    throw new Error(`pandoc LaTeX generation failed: ${err.message}`)
  }

  if (result.stderr) {
    console.warn('[pandoc latex stderr]', result.stderr)
    onLog?.(result.stderr.slice(0, 200))
  }

  const latex = result.stdout ?? ''
  if (!latex) throw new Error(`pandoc produced empty LaTeX output. stderr: ${result.stderr}`)

  onLog?.('LaTeX generated successfully.')
  return latex
}

// ── Stage 3: LaTeX → PDF ──────────────────────────────────────────────────────

/**
 * Compile a LaTeX string to PDF using BusyTeX XeLaTeX.
 *
 * @param {string} latexSource
 * @param {{ path: string, content: string|Uint8Array }[]} additionalFiles  Media files
 * @param {function} onLog
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function compileLaTeXToPDF(latexSource, additionalFiles, onLog) {
  onLog?.('Initialising XeLaTeX (this may take a moment on first use)…')
  const worker = await ensureBusytex()
  const termesFiles = await getTermesFiles()
  onLog?.('Compiling PDF with XeLaTeX…')

  const startTime = Date.now()
  const iconFiles = await getIconPackages()
  const files = [
    { path: 'main.tex', contents: latexSource },
    ...(additionalFiles || []).map(f => ({ path: f.path, contents: f.contents })),
    ...termesFiles,
    ...iconFiles,
  ]

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      _compilePending = null
      reject(new Error('XeLaTeX compilation timed out (600s)'))
    }, 600_000)

    _compilePending = {
      onLog,
      resolve: (data) => {
        clearTimeout(timeout)
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        onLog?.(`Compilation finished in ${elapsed}s.`)

        if (data.log) {
          onLog?.('─── XeLaTeX log ───')
          for (const line of data.log.split('\n')) onLog?.(line)
          onLog?.('─── end of log ───')
        }

        if (!data.pdf || data.exit_code !== 0) {
          reject(new Error(`XeLaTeX failed (exit ${data.exit_code})`))
          return
        }

        onLog?.('─── PDF compiled successfully. ───')
        resolve(data.pdf)
      },
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      },
    }

    worker.postMessage({
      files,
      main_tex_path: 'main.tex',
      bibtex: false,
      verbose: 'silent',
      driver: 'xetex_bibtex8_dvipdfmx',
      data_packages_js: [
        `${new URL('/core/busytex/', window.location.href).href}texlive-basic.js`,
        `${new URL('/core/busytex/', window.location.href).href}ubuntu-texlive-latex-recommended.js`,
        `${new URL('/core/busytex/', window.location.href).href}ubuntu-texlive-latex-extra.js`,
      ],
    })
  })
}

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Build issue-level YAML from issue metadata.
 * Merges with the base journal YAML (set in journal.yaml).
 */
export function buildIssueYaml({ volume, issue, year, issuedisplay, issuetitle, issuecolor, ...rest }) {
  const lines = [
    `volume: ${volume}`,
    `issue: ${issue}`,
    `year: ${year}`,
    `issuedisplay: "${issuedisplay}"`,
  ]
  if (issuetitle) lines.push(`issuetitle: "${issuetitle}"`)
  if (issuecolor) lines.push(`issuecolor: "${issuecolor}"`)
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null) {
      lines.push(`${k}: "${v}"`)
    }
  }
  return lines.join('\n')
}

/**
 * Convert a mediaFiles map to resource records for pandoc.
 */
export function mediaMapToResources(mediaMap) {
  return Array.from(mediaMap.entries()).map(([path, blob]) => ({
    filename: path,
    contents: blob,
  }))
}

/**
 * Convert a mediaFiles map to additional file records for XeLaTeX injection.
 */
export function mediaMapToAdditionalFiles(mediaMap) {
  return Array.from(mediaMap.entries()).map(([path, blob]) => ({
    path,
    contents: blob,
  }))
}
