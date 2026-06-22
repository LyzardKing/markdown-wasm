export function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*\r?\n?([\s\S]*)$/s)
  if (match) {
    return { yaml: match[1], body: match[2] }
  }
  return { yaml: '', body: text }
}

export function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim()
}
