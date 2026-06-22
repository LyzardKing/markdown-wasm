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

const TEMPLATE_TITLE = 'Title of the article'
const TEMPLATE_AUTHOR = 'Name Surname'

export function deriveArticleDisplayName(yaml, fallback) {
  if (!yaml) return fallback ?? 'Untitled'
  const clean = yaml.replace(/#.*$/gm, '')
  const titleM = clean.match(/^title:\s*"([^"]*)"\s*$/m)
  const title = titleM ? titleM[1].trim() : null
  const authorM = clean.match(/^author:\s*\n\s+-\s+name:\s*"([^"]*)"\s*$/m)
  const author = authorM ? authorM[1].trim() : null
  if (author && title && author !== TEMPLATE_AUTHOR && title !== TEMPLATE_TITLE)
    return `${author} - ${title}`
  if (title && title !== TEMPLATE_TITLE)
    return title
  return fallback ?? 'Untitled'
}
