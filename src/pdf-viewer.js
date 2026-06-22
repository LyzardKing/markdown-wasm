export function watchPageCountFromViewer(iframe, article, onPageCountChange) {
  const tryRead = () => {
    try {
      const doc = iframe.contentDocument
      if (!doc) return false
      const el = doc.getElementById('numPages') || doc.getElementById('totalPages')
      if (!el) return false
      const n = parseInt(el.textContent.match(/\d+/)?.[0], 10)
      if (!n) return false
      if (n !== article.pageCount) {
        article.pageCount = n
        onPageCountChange?.(n)
      }
      return true
    } catch { return false }
  }

  iframe.addEventListener('load', () => {
    let attempts = 0
    const poll = setInterval(() => {
      if (tryRead() || ++attempts > 30) clearInterval(poll)
    }, 400)
  }, { once: true })
}
