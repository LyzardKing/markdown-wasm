/**
 * main.js — App entry point
 *
 * Manages state (current issue, current article) and wires UI events to
 * IndexedDB operations and the conversion pipeline.
 */

import JSZip from 'jszip'

import * as db from './db.js'
import {
  createMarkdownEditor,
  createYamlEditor,
  getContent,
  setContent,
} from './editor.js'
import {
  convertDocxToMarkdown,
  convertMarkdownToLatex,
  compileLaTeXToPDF,
  warmupBusytex,
  buildIssueYaml,
  mediaMapToAdditionalFiles,
  mediaMapToResources,
} from './pipeline.js'
import articleYamlTemplate from './templates/article.yaml?raw'

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  issues: [],
  currentIssue: null,
  articles: [],
  currentArticle: null,
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id)

const issueList         = $('issue-list')
const btnNewIssue       = $('btn-new-issue')
const issueForm         = $('issue-form')
const btnCancelIssue    = $('btn-cancel-issue')
const currentIssueInfo  = $('current-issue-info')
const currentIssueTitle = $('current-issue-title')
const currentIssueMeta  = $('current-issue-meta')

const articlesPanel   = $('articles-panel')
const articleList     = $('article-list')
const fileInput       = $('file-input')
const btnExportIssue  = $('btn-export-issue')

const editorPanel  = $('editor-panel')
const editorTitle  = $('editor-title')
const mdEditorEl   = $('md-editor')
const yamlEditorEl = $('yaml-editor')

// CodeMirror views — initialised once the DOM elements exist
const mdView   = createMarkdownEditor(mdEditorEl)
const yamlView = createYamlEditor(yamlEditorEl)
const btnSaveMd    = $('btn-save-md')
const btnGenerate  = $('btn-generate')

const outputPanel     = $('output-panel')
const outputLog       = $('output-log')
const outputDownloads = $('output-downloads')
const outputPdf       = $('output-pdf')
const pdfFrame        = $('pdf-frame')
const btnRegenerate   = $('btn-regenerate')
const btnBackEditor   = $('btn-back-editor')

const spinner    = $('spinner')
const spinnerMsg = $('spinner-msg')

// ── Spinner helpers ───────────────────────────────────────────────────────────

function showSpinner(msg = 'Processing…') {
  spinnerMsg.textContent = msg
  spinner.classList.remove('hidden')
}

function hideSpinner() {
  spinner.classList.add('hidden')
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'))
    $(`tab-${btn.dataset.tab}`).classList.remove('hidden')
  })
})

// ── Issue UI ─────────────────────────────────────────────────────────────────

btnNewIssue.addEventListener('click', () => {
  issueForm.classList.toggle('hidden')
})

btnCancelIssue.addEventListener('click', () => {
  issueForm.classList.add('hidden')
  issueForm.reset()
})

// Auto-populate display from volume/issue/year
function updateIssueDisplay() {
  const v = issueForm.elements['volume'].value.trim()
  const i = issueForm.elements['issue'].value.trim()
  const y = issueForm.elements['year'].value.trim()
  const display = $('issuedisplay')
  if (v || i || y) {
    display.value = `Vol. ${v} n. ${i} (${y})`
  }
}

;['volume', 'issue', 'year'].forEach(name => {
  issueForm.elements[name].addEventListener('input', updateIssueDisplay)
})

issueForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(issueForm))
  if (!data.issuedisplay) {
    data.issuedisplay = `Vol. ${data.volume} n. ${data.issue} (${data.year})`
  }
  await db.createIssue(data)
  issueForm.reset()
  issueForm.classList.add('hidden')
  await loadIssues()
})

async function loadIssues() {
  state.issues = await db.getIssues()
  renderIssueList()
}

function renderIssueList() {
  issueList.innerHTML = ''
  for (const issue of state.issues) {
    const li = document.createElement('li')
    li.textContent = issue.issuedisplay || `${issue.year} – ${issue.volume}/${issue.issue}`
    li.dataset.id = issue.id
    if (state.currentIssue?.id === issue.id) li.classList.add('active')
    li.addEventListener('click', () => selectIssue(issue))
    issueList.appendChild(li)
  }
}

async function selectIssue(issue) {
  state.currentIssue = issue
  state.currentArticle = null

  renderIssueList()

  // Update sidebar info
  currentIssueInfo.classList.remove('hidden')
  currentIssueTitle.textContent = issue.issuedisplay
  currentIssueMeta.textContent = `Vol. ${issue.volume}, n. ${issue.issue} (${issue.year})`

  // Show articles panel, hide others
  articlesPanel.classList.remove('hidden')
  editorPanel.classList.add('hidden')
  outputPanel.classList.add('hidden')

  await loadArticles()
}

// ── Article UI ────────────────────────────────────────────────────────────────

async function loadArticles() {
  if (!state.currentIssue) return
  state.articles = await db.getArticlesByIssue(state.currentIssue.id)
  renderArticleList()
}

function statusLabel(status) {
  const map = {
    converting: ['Converting…', 'status-converting'],
    ready:      ['Ready',       'status-ready'],
    error:      ['Error',       'status-error'],
    pending:    ['Pending',     'status-pending'],
  }
  return map[status] ?? ['Unknown', 'status-pending']
}

function renderArticleList() {
  articleList.innerHTML = ''

  if (!state.currentIssue) {
    articleList.innerHTML = '<li class="placeholder">Select or create an issue to get started.</li>'
    return
  }

  if (state.articles.length === 0) {
    articleList.innerHTML = '<li class="placeholder">No articles yet. Upload a DOCX file.</li>'
    return
  }

  for (const article of state.articles) {
    const li = document.createElement('li')
    li.className = 'article-item'
    li.dataset.id = article.id
    if (state.currentArticle?.id === article.id) li.classList.add('active')

    const [label, cls] = statusLabel(article.status)

    li.innerHTML = `
      <span class="article-name" title="${article.name}">${article.name}</span>
      <span class="article-status ${cls}">${label}</span>
      <button class="article-delete" title="Delete article" data-id="${article.id}">×</button>
    `

    li.querySelector('.article-name, .article-status').addEventListener('click', () => {
      if (article.status === 'ready') selectArticle(article)
    })

    // Clicking the whole row if ready
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('article-delete')) return
      if (article.status === 'ready') selectArticle(article)
    })

    li.querySelector('.article-delete').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`Delete "${article.name}"?`)) return
      await db.deleteArticle(article.id)
      if (state.currentArticle?.id === article.id) {
        state.currentArticle = null
        editorPanel.classList.add('hidden')
        outputPanel.classList.add('hidden')
      }
      await loadArticles()
    })

    articleList.appendChild(li)
  }
}

// ── File upload → Stage 1 conversion ─────────────────────────────────────────

fileInput.addEventListener('change', async (e) => {
  if (!state.currentIssue) {
    alert('Please select or create an issue first.')
    fileInput.value = ''
    return
  }

  const files = Array.from(e.target.files)
  fileInput.value = ''

  for (const file of files) {
    await handleFileUpload(file)
  }
})

async function handleFileUpload(file) {
  // Create article record immediately with "converting" status
  const name = file.name.replace(/\.(docx|odt)$/i, '')
  const articleId = await db.createArticle({
    issueId: state.currentIssue.id,
    name,
    yaml: '',
    markdown: '',
    mediaFiles: {},
    status: 'converting',
  })

  await loadArticles()

  showSpinner(`Converting ${file.name}…`)

  const logs = []
  const onLog = (msg) => {
    logs.push(msg)
    spinnerMsg.textContent = msg.slice(0, 60)
  }

  try {
    console.log('[upload] starting pandoc conversion for', file.name)
    const { markdown, mediaFiles } = await convertDocxToMarkdown(file, onLog)
    console.log('[upload] pandoc done. markdown length:', markdown?.length, 'media files:', [...(mediaFiles?.keys() ?? [])])

    // Store media as plain object — IndexedDB can store Blobs natively.
    const mediaObj = {}
    for (const [path, blob] of mediaFiles) {
      mediaObj[path] = blob
    }

    // The markdown from pandoc includes a YAML frontmatter block (from -s flag).
    // Separate the pandoc-generated YAML from the body, then replace with our template.
    const { yaml: pandocYaml, body } = splitFrontmatter(markdown)
    console.log('[upload] frontmatter split. yaml length:', pandocYaml?.length, 'body length:', body?.length)
    console.log('[upload] body preview:', body?.slice(0, 200))

    // Pre-fill title from pandoc-extracted metadata if available
    const titleMatch = pandocYaml.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    const title = titleMatch ? titleMatch[1] : name
    console.log('[upload] detected title:', title)

    // Use our article template YAML, inserting the detected title
    const finalYaml = articleYamlTemplate.replace(
      /^(title:\s*).*$/m,
      `$1"${title.replace(/"/g, '\\"')}"`
    )

    console.log('[upload] saving to DB, articleId:', articleId)
    await db.updateArticle(articleId, {
      yaml: finalYaml,
      markdown: body,
      mediaFiles: mediaObj,
      status: 'ready',
    })

    // Verify save
    const saved = await db.getArticle(articleId)
    console.log('[upload] DB read-back — status:', saved?.status, 'markdown length:', saved?.markdown?.length)

    // Auto-open the article in the editor
    await loadArticles()
    await selectArticle(articleId)

  } catch (err) {
    console.error('[upload] error:', err)
    await db.updateArticle(articleId, { status: 'error', markdown: err.message })
  } finally {
    hideSpinner()
    await loadArticles()
  }
}

/** Split a markdown string into its YAML frontmatter and body. */
function splitFrontmatter(text) {
  // Pandoc closes frontmatter with either --- or ...
  // The closing delimiter may or may not be followed by a newline/content.
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*\r?\n?([\s\S]*)$/s)
  if (match) {
    console.log('[splitFrontmatter] matched. yaml:', match[1].length, 'body:', match[2].length)
    return { yaml: match[1], body: match[2] }
  }
  console.warn('[splitFrontmatter] no frontmatter found, treating entire text as body. preview:', text.slice(0, 120))
  return { yaml: '', body: text }
}

// ── Editor ────────────────────────────────────────────────────────────────────

async function selectArticle(articleOrId) {
  // Always re-fetch from DB to get the latest content
  const id = typeof articleOrId === 'object' ? articleOrId.id : articleOrId
  console.log('[selectArticle] fetching id:', id)
  const article = await db.getArticle(id)
  console.log('[selectArticle] fetched:', article?.name, '| status:', article?.status, '| markdown length:', article?.markdown?.length)
  if (!article) return

  // Revoke old PDF blob URL
  if (state._pdfUrl) {
    URL.revokeObjectURL(state._pdfUrl)
    state._pdfUrl = null
  }

  state.currentArticle = article
  renderArticleList()

  editorTitle.textContent = article.name
  setContent(yamlView, article.yaml ?? '')
  setContent(mdView, article.markdown ?? '')

  articlesPanel.classList.remove('hidden')
  editorPanel.classList.remove('hidden')
  outputPanel.classList.add('hidden')

  // Show cached PDF directly if available
  if (article.pdf) {
    editorPanel.classList.add('hidden')
    outputPanel.classList.remove('hidden')
    outputLog.innerHTML = ''
    outputLog.classList.add('hidden')
    outputDownloads.innerHTML = ''

    const pdfBlob = new Blob([article.pdf], { type: 'application/pdf' })
    const url = URL.createObjectURL(pdfBlob)
    pdfFrame.src = url
    outputPdf.classList.remove('hidden')
    btnRegenerate.textContent = 'Regenerate'
    btnRegenerate.classList.remove('hidden')
    state._pdfUrl = url
  }
}

btnSaveMd.addEventListener('click', async () => {
  if (!state.currentArticle) return
  await db.updateArticle(state.currentArticle.id, {
    yaml: getContent(yamlView),
    markdown: getContent(mdView),
    updatedAt: Date.now(),
  })
  state.currentArticle = await db.getArticle(state.currentArticle.id)
  btnSaveMd.textContent = 'Saved ✓'
  setTimeout(() => { btnSaveMd.textContent = 'Save' }, 1500)
})

// ── Pipeline (compile LaTeX → PDF) ────────────────────────────────────────────

async function runPipeline() {
  if (!state.currentArticle || !state.currentIssue) return

  // Save current editor state first
  await db.updateArticle(state.currentArticle.id, {
    yaml: getContent(yamlView),
    markdown: getContent(mdView),
    updatedAt: Date.now(),
  })
  state.currentArticle = await db.getArticle(state.currentArticle.id)

  // Ensure we're in the output panel
  articlesPanel.classList.remove('hidden')
  editorPanel.classList.add('hidden')
  outputPanel.classList.remove('hidden')

  // Reset output for fresh compilation
  outputLog.innerHTML = ''
  outputLog.classList.remove('hidden')
  outputDownloads.innerHTML = ''
  outputPdf.classList.add('hidden')
  pdfFrame.src = ''
  btnRegenerate.classList.add('hidden')
  if (state._pdfUrl) {
    URL.revokeObjectURL(state._pdfUrl)
    state._pdfUrl = null
  }

  const log = (msg, type = '') => {
    const span = document.createElement('span')
    span.className = type ? `log-${type}` : ''
    span.textContent = msg + '\n'
    outputLog.appendChild(span)
    outputLog.scrollTop = outputLog.scrollHeight
  }

  // Use a small inline progress indicator instead of the full-screen spinner
  // so the log remains visible throughout
  const progressEl = document.createElement('div')
  progressEl.id = 'inline-progress'
  progressEl.innerHTML = '<span class="spinner-ring" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></span><span id="inline-progress-msg">Starting…</span>'
  outputPanel.querySelector('.panel-header').appendChild(progressEl)
  const setProgress = (msg) => {
    const el = document.getElementById('inline-progress-msg')
    if (el) el.textContent = msg
  }

  try {
    const article = state.currentArticle
    const issue   = state.currentIssue

    const markdownWithFrontmatter = `${article.yaml}\n\n${article.markdown}`
    const issueYaml = buildIssueYaml(issue)

    // Rebuild media files as pandoc resources
    const mediaResources = []
    const mediaAdditional = []
    for (const [path, blob] of Object.entries(article.mediaFiles ?? {})) {
      if (blob instanceof Blob) {
        mediaResources.push({ filename: path, contents: blob })
        const buf = await blob.arrayBuffer()
        mediaAdditional.push({ path, content: new Uint8Array(buf) })
      }
    }

    // ── LaTeX (.tex) ──────────────────────────────────────────────────────────
    log('▶ Stage 1/2: Markdown → LaTeX')
    setProgress('Generating LaTeX…')

    let latex
    try {
      latex = await convertMarkdownToLatex(
        markdownWithFrontmatter,
        issueYaml,
        mediaResources,
        log
      )
      log('  LaTeX generated.', 'ok')
      addDownload(article.name + '.tex', latex, 'text/x-tex', '📄 .tex')
      // Cache LaTeX in DB for export
      await db.updateArticle(article.id, { tex: latex }).catch(() => {})
    } catch (err) {
      log(`  LaTeX failed: ${err.message}`, 'err')
      throw err
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    log('▶ Stage 2/2: LaTeX → PDF (XeLaTeX)')
    log('  Note: first run loads TeX Live packages (~400 MB) — this takes 1–2 minutes.', 'warn')
    setProgress('Compiling PDF (XeLaTeX)…')

    try {
      const pdf = await compileLaTeXToPDF(latex, mediaAdditional, log)
      log('  PDF compiled.', 'ok')
      // Cache PDF in DB for export
      await db.updateArticle(article.id, { pdf, generatedAt: Date.now() }).catch(() => {})
      // Show PDF inline and collapse log
      const pdfBlob = new Blob([pdf], { type: 'application/pdf' })
      const url = URL.createObjectURL(pdfBlob)
      pdfFrame.src = url
      outputLog.classList.add('hidden')
      outputPdf.classList.remove('hidden')
      btnRegenerate.textContent = 'Regenerate'
      btnRegenerate.classList.remove('hidden')
      state._pdfUrl = url
    } catch (err) {
      log(`  PDF failed: ${err.message}`, 'err')
      // Don't rethrow — LaTeX is still available
    }

    log('Done.', 'ok')
  } catch (err) {
    log(`Error: ${err.message}`, 'err')
    console.error(err)
  } finally {
    document.getElementById('inline-progress')?.remove()
  }
}

// ── Go to PDF (navigate to output panel) ─────────────────────────────────────

btnGenerate.addEventListener('click', async () => {
  if (!state.currentArticle || !state.currentIssue) return

  // Save current editor state
  await db.updateArticle(state.currentArticle.id, {
    yaml: getContent(yamlView),
    markdown: getContent(mdView),
    updatedAt: Date.now(),
  })
  state.currentArticle = await db.getArticle(state.currentArticle.id)

  // Revoke old PDF blob URL
  if (state._pdfUrl) {
    URL.revokeObjectURL(state._pdfUrl)
    state._pdfUrl = null
  }

  // Switch to output panel
  articlesPanel.classList.remove('hidden')
  editorPanel.classList.add('hidden')
  outputPanel.classList.remove('hidden')
  outputLog.innerHTML = ''
  outputDownloads.innerHTML = ''
  outputPdf.classList.add('hidden')
  pdfFrame.src = ''

  // Show cached PDF or generate prompt
  if (state.currentArticle.pdf) {
    outputLog.classList.add('hidden')
    const pdfBlob = new Blob([state.currentArticle.pdf], { type: 'application/pdf' })
    const url = URL.createObjectURL(pdfBlob)
    pdfFrame.src = url
    outputPdf.classList.remove('hidden')
    btnRegenerate.textContent = 'Regenerate'
    btnRegenerate.classList.remove('hidden')
    state._pdfUrl = url
  } else {
    outputLog.textContent = 'No PDF yet. Click Generate to start compilation.\n'
    outputLog.classList.remove('hidden')
    btnRegenerate.textContent = 'Generate'
    btnRegenerate.classList.remove('hidden')
  }
})

btnRegenerate.addEventListener('click', runPipeline)

function addDownload(filename, content, mime, label) {
  const blob = new Blob([content], { type: mime })
  addDownloadBlob(filename, blob, label)
}

function addDownloadBlob(filename, blob, label) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.className = 'download-btn'
  a.href = url
  a.download = filename
  a.innerHTML = `<span class="icon">${label.split(' ')[0]}</span> Download ${label.split(' ').slice(1).join(' ')} — ${filename}`
  outputDownloads.appendChild(a)
}

btnBackEditor.addEventListener('click', () => {
  outputPanel.classList.add('hidden')
  editorPanel.classList.remove('hidden')
})

// ── Export issue ──────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim()
}

async function exportIssue() {
  const issue = state.currentIssue
  if (!issue) return

  const articles = state.articles.filter(a => a.status === 'ready')
  if (articles.length === 0) {
    alert('No articles to export.')
    return
  }

  // Reload from DB to get cached pdf/tex
  const all = await Promise.all(articles.map(a => db.getArticle(a.id)))

  // Check that every article has a cached PDF and is not stale
  const missing = all.filter(a => !a.pdf)
  if (missing.length > 0) {
    const names = missing.map(a => `"${a.name}"`).join(', ')
    alert(`Cannot export — PDF missing for: ${names}. Open each article and run Generate first.`)
    return
  }

  const stale = all.filter(a => {
    if (!a.updatedAt) return false
    if (!a.generatedAt) return true
    return a.updatedAt > a.generatedAt
  })
  if (stale.length > 0) {
    const names = stale.map(a => `"${a.name}"`).join(', ')
    if (!confirm(`PDF is outdated for: ${names}. Content was modified after the last compilation. Export anyway?`))
      return
  }

  showSpinner('Preparing export…')

  const zip = new JSZip()
  const safe = sanitizeFilename(issue.issuedisplay || `issue-${issue.id}`)
  const root = zip.folder(safe)

  for (const article of all) {
    const dirName = sanitizeFilename(article.name)
    const dir = root.folder(dirName)

    // Markdown
    const mdContent = `${article.yaml}\n\n${article.markdown}`
    dir.file(`${dirName}.md`, mdContent)

    // LaTeX (cached only)
    if (article.tex) dir.file(`${dirName}.tex`, article.tex)

    // PDF (cached, guaranteed to exist by the check above)
    dir.file(`${dirName}.pdf`, article.pdf)
  }

  spinnerMsg.textContent = 'Creating ZIP…'
  const blob = await zip.generateAsync({ type: 'blob' })
  hideSpinner()

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.zip`
  a.click()
  URL.revokeObjectURL(url)

  console.log(`Exported ${all.length} article(s)`)
}

btnExportIssue.addEventListener('click', exportIssue)

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await loadIssues()
  // Start loading TeX Live data packages in the background immediately so
  // they are ready (and cached in IndexedDB) before the user hits Generate.
  warmupBusytex().catch(() => {/* ignore background errors */})

  // Production API exposed on window for console-based testing.
  // Usage: testTex(`\\documentclass{article}\\begin{document}Hello\\end{document}`)
  window.testTex = async (latex) => {
    const logs = []
    const onLog = msg => { logs.push(msg); console.log('[tex]', msg) }
    try {
      const pdf = await compileLaTeXToPDF(latex, [], onLog)
      console.log('✓ PDF compiled, size:', pdf.byteLength)
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
      window.open(url)
      return { ok: true, pdf, logs }
    } catch (err) {
      console.error('✗ PDF failed:', err.message)
      console.error('Log:\n' + logs.join('\n'))
      return { ok: false, error: err.message, logs }
    }
  }
}

init()
