#!/usr/bin/env node
/**
 * Downloads fontawesome5 and academicons TDS packages from CTAN
 * and extracts the needed files into public/core/busytex/extras/
 *
 * Run via: node scripts/setup-icon-packages.js
 * Also added to npm run setup in package.json.
 */
import { execSync } from 'child_process'
import { mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dest = join(__dirname, '..', 'public', 'core', 'busytex', 'extras')

// Skip if already present (e.g. cached from a previous build)
if (existsSync(join(dest, 'tex', 'fontawesome5.sty'))) {
  console.log('Icon packages already present, skipping download.')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })

const TMP = '/tmp/opencode/ctan-icon-packages'
mkdirSync(TMP, { recursive: true })

const packages = [
  {
    url: 'https://mirrors.ctan.org/fonts/fontawesome5.zip',
    zip: join(TMP, 'fontawesome5.zip'),
    dir: 'fontawesome5',
  },
  {
    url: 'https://mirrors.ctan.org/fonts/academicons.zip',
    zip: join(TMP, 'academicons.zip'),
    dir: 'academicons',
  },
]

for (const pkg of packages) {
  console.log(`Downloading ${pkg.url}...`)
  execSync(`curl -sL --connect-timeout 30 -o "${pkg.zip}" "${pkg.url}"`, { stdio: 'inherit' })
  console.log(`Extracting ${pkg.zip}...`)
  execSync(`unzip -q -o -d "${TMP}" "${pkg.zip}"`, { stdio: 'inherit' })

  const srcDir = join(TMP, pkg.dir)
  console.log(`Copying files to ${dest}...`)
  execSync(`cp -r "${srcDir}/." "${dest}/"`, { stdio: 'inherit' })
}

console.log('\nIcon packages extracted to', dest)
