/**
 * editor.js — CodeMirror 6 editor factory
 *
 * Creates syntax-highlighted editors for Markdown, YAML and LaTeX.
 */

import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { latex } from 'codemirror-lang-latex'

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, monospace)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px' },
  '.cm-gutters': { background: '#f8fafc', borderRight: '1px solid var(--border)' },
})

export function createMarkdownEditor(parent, content = '') {
  return new EditorView({
    doc: content,
    extensions: [basicSetup, markdown(), EditorView.lineWrapping, baseTheme],
    parent,
  })
}

export function createYamlEditor(parent, content = '') {
  return new EditorView({
    doc: content,
    extensions: [basicSetup, yaml(), baseTheme],
    parent,
  })
}

export function createTexEditor(parent, content = '') {
  return new EditorView({
    doc: content,
    extensions: [basicSetup, latex(), EditorView.lineWrapping, baseTheme],
    parent,
  })
}

/** Get the current document content from a CodeMirror view. */
export function getContent(view) {
  return view.state.doc.toString()
}

/** Replace the entire document content of a CodeMirror view. */
export function setContent(view, content) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content ?? '' },
  })
}
