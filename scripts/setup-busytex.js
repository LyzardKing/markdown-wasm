#!/usr/bin/env node
/**
 * Downloads the original busytex WASM assets from GitHub releases.
 * Run via: npm run setup
 *
 * Assets go into public/core/busytex/ and are served statically.
 * The ubuntu-texlive-latex-* packages include fontspec, fontawesome5,
 * academicons, datetime2, microtype, etc. which the texlyre bundles lacked.
 */
import { execSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dest = join(__dirname, '..', 'public', 'core', 'busytex')
mkdirSync(dest, { recursive: true })

const base = 'https://busytex.github.io/dist'

const files = [
  'busytex_pipeline.js',
  'busytex_worker.js',
  'busytex.wasm',
  'busytex.js',
  'texlive-basic.js',
  'texlive-basic.data',
  'ubuntu-texlive-latex-recommended.js',
  'ubuntu-texlive-latex-recommended.data',
  'ubuntu-texlive-latex-extra.js',
  'ubuntu-texlive-latex-extra.data',
]

// Skip download if assets already exist (e.g. cached from a previous build)
const marker = join(dest, 'busytex_worker.js')
if (existsSync(marker)) {
  console.log('Assets already present, skipping download.')
} else {
  for (const file of files) {
    const url = `${base}/${file}`
    const out = join(dest, file)
    console.log(`Downloading ${file}...`)
    execSync(`wget -q --show-progress -O "${out}" "${url}"`, { stdio: 'inherit' })
  }
  console.log('\nbusytex assets downloaded to public/core/busytex/')
}
