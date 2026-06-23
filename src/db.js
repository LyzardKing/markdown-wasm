/**
 * db.js — IndexedDB wrapper for issues and articles
 *
 * Stores:
 *   issues   — { id, volume, issue, year, issuedisplay, createdAt }
 *   articles — { id, issueId, name, yaml, markdown, mediaFiles, status, createdAt }
 *
 * mediaFiles is stored as { filename: Uint8Array } for binary, or string for text.
 */

const DB_NAME = 'markdown-workflow'
const DB_VERSION = 2

let _db = null

function openDB() {
  if (_db) return Promise.resolve(_db)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }

      if (!db.objectStoreNames.contains('issues')) {
        const issueStore = db.createObjectStore('issues', { keyPath: 'id', autoIncrement: true })
        issueStore.createIndex('createdAt', 'createdAt')
      }

      if (!db.objectStoreNames.contains('articles')) {
        const articleStore = db.createObjectStore('articles', { keyPath: 'id', autoIncrement: true })
        articleStore.createIndex('issueId', 'issueId')
        articleStore.createIndex('createdAt', 'createdAt')
      }
    }

    req.onsuccess = (e) => {
      _db = e.target.result
      resolve(_db)
    }

    req.onerror = () => reject(req.error)
  })
}

function tx(storeName, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName))
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Issues ──────────────────────────────────────────────────────────────────

export async function getIssues() {
  const store = await tx('issues')
  return promisify(store.getAll())
}

export async function getIssue(id) {
  const store = await tx('issues')
  return promisify(store.get(id))
}

export async function createIssue(data) {
  const store = await tx('issues', 'readwrite')
  return promisify(store.add({ ...data, createdAt: Date.now() }))
}

export async function updateIssue(id, patch) {
  const store = await tx('issues', 'readwrite')
  const issue = await promisify(store.get(id))
  if (!issue) throw new Error(`Issue ${id} not found`)
  const updated = { ...issue, ...patch }
  await promisify(store.put(updated))
  return updated
}

export async function deleteIssue(id) {
  // Also delete all articles belonging to this issue
  const articles = await getArticlesByIssue(id)
  for (const a of articles) await deleteArticle(a.id)

  const store = await tx('issues', 'readwrite')
  return promisify(store.delete(id))
}

// ── Articles ─────────────────────────────────────────────────────────────────

export async function getArticlesByIssue(issueId) {
  const store = await tx('articles')
  const index = store.index('issueId')
  const articles = await promisify(index.getAll(issueId))

  // Backfill sortOrder for existing articles that lack it,
  // using their auto-increment id to preserve current relative order.
  const toUpdate = articles.filter(a => a.sortOrder == null)
  if (toUpdate.length > 0) {
    const writeStore = await tx('articles', 'readwrite')
    for (const article of toUpdate) {
      article.sortOrder = article.id
      await promisify(writeStore.put(article))
    }
  }

  articles.sort((a, b) => a.sortOrder - b.sortOrder)
  return articles
}

export async function getArticle(id) {
  const store = await tx('articles')
  return promisify(store.get(id))
}

export async function createArticle(data) {
  const store = await tx('articles', 'readwrite')
  return promisify(store.add({ ...data, sortOrder: Date.now(), createdAt: Date.now() }))
}

export async function updateArticle(id, patch) {
  const store = await tx('articles', 'readwrite')
  const article = await promisify(store.get(id))
  if (!article) throw new Error(`Article ${id} not found`)
  const updated = { ...article, ...patch }
  await promisify(store.put(updated))
  return updated
}

export async function deleteArticle(id) {
  const store = await tx('articles', 'readwrite')
  return promisify(store.delete(id))
}

export async function updateArticlesOrder(ids) {
  const store = await tx('articles', 'readwrite')
  for (let i = 0; i < ids.length; i++) {
    const article = await promisify(store.get(ids[i]))
    if (article) {
      article.sortOrder = i
      await promisify(store.put(article))
    }
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings() {
  const store = await tx('settings')
  return promisify(store.get('journal'))
}

export async function saveSettings(data) {
  const store = await tx('settings', 'readwrite')
  return promisify(store.put({ key: 'journal', ...data }))
}
