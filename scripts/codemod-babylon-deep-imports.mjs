#!/usr/bin/env node
/**
 * Convert barrel `from '@babylonjs/core'` imports to deep paths for tree-shaking.
 * Run: node scripts/codemod-babylon-deep-imports.mjs [--check]
 */

import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'glob'

const ROOT = path.resolve(import.meta.dirname, '..')
const CORE_PKG = path.join(ROOT, 'node_modules/@babylonjs/core')
const CHECK_ONLY = process.argv.includes('--check')

/** @type {Map<string, string>} */
const symbolToModule = buildSymbolMap()

function buildSymbolMap() {
  /** @type {Map<string, string>} */
  const map = new Map()

  function walk(dir, rel = '') {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name)
      const moduleRel = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        if (ent.name === 'Legacy') continue
        walk(abs, moduleRel)
        continue
      }
      if (!ent.name.endsWith('.d.ts') || ent.name === 'index.d.ts') continue

      const mod = moduleRel.replace(/\.d\.ts$/, '')
      const text = fs.readFileSync(abs, 'utf8')
      const modulePath = `@babylonjs/core/${mod}`

      const declRe = /^export (?:declare )?(?:abstract )?(?:class|interface|type|enum|function|const) ([A-Za-z0-9_]+)/gm
      let match
      while ((match = declRe.exec(text))) {
        if (!map.has(match[1])) map.set(match[1], modulePath)
      }

      const namedRe = /^export \{([^}]+)\}/gm
      while ((match = namedRe.exec(text))) {
        for (const part of match[1].split(',')) {
          const trimmed = part.trim()
          if (!trimmed) continue
          const symbol = trimmed.split(/\s+as\s+/).pop().trim()
          if (symbol && /^[A-Za-z]/.test(symbol) && !map.has(symbol)) {
            map.set(symbol, modulePath)
          }
        }
      }
    }
  }

  walk(CORE_PKG)
  return map
}

function resolveSymbol(symbol) {
  const mod = symbolToModule.get(symbol)
  if (!mod) {
    throw new Error(`Unknown Babylon symbol: ${symbol}`)
  }
  return mod
}

/**
 * @param {string} text
 * @returns {string}
 */
function transformFile(text) {
  let out = text

  // import { A, type B } from '@babylonjs/core'
  const importRe =
    /^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]@babylonjs\/core['"];?\s*$/gm

  out = out.replace(importRe, (full, leadingType, specifiersRaw) => {
    /** @type {Map<string, { symbol: string, isType: boolean }[]>} */
    const byModule = new Map()

    for (const part of specifiersRaw.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue

      let isType = Boolean(leadingType)
      let token = trimmed
      if (token.startsWith('type ')) {
        isType = true
        token = token.slice(5).trim()
      }

      const [imported, alias] = token.split(/\s+as\s+/).map((s) => s.trim())
      const symbol = alias ?? imported
      const modulePath = resolveSymbol(imported)

      if (!byModule.has(modulePath)) byModule.set(modulePath, [])
      byModule.get(modulePath).push({ symbol: `${imported}${alias ? ` as ${alias}` : ''}`, isType })
    }

    const lines = []
    for (const [modulePath, entries] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const typeEntries = entries.filter((e) => e.isType)
      const valueEntries = entries.filter((e) => !e.isType)

      if (valueEntries.length > 0) {
        lines.push(
          `import { ${valueEntries.map((e) => e.symbol).join(', ')} } from '${modulePath}'`,
        )
      }
      if (typeEntries.length > 0) {
        lines.push(
          `import type { ${typeEntries.map((e) => e.symbol).join(', ')} } from '${modulePath}'`,
        )
      }
    }

    return lines.join('\n')
  })

  // import type { X } from '@babylonjs/core' already handled above.
  // import Scene from '@babylonjs/core' — not used in this codebase.

  // import('@babylonjs/core').Vector3 inline type refs
  out = out.replace(
    /import\(['"]@babylonjs\/core['"]\)\.([A-Za-z0-9_]+)/g,
    (_, symbol) => {
      resolveSymbol(symbol)
      return `import('${resolveSymbol(symbol)}').${symbol}`
    },
  )

  return out
}

function main() {
  const files = globSync('{src,tests}/**/*.{ts,tsx}', { cwd: ROOT, absolute: true })
  let changed = 0

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8')
    if (!original.includes("@babylonjs/core'") && !original.includes('@babylonjs/core"')) continue
    if (original.includes("@babylonjs/core/")) {
      // Still may have mixed barrel + deep imports in same file
    }

    const hasBarrel =
      /from\s+['"]@babylonjs\/core['"]/.test(original) ||
      /import\(['"]@babylonjs\/core['"]\)/.test(original)
    if (!hasBarrel) continue

    const transformed = transformFile(original)
    if (transformed !== original) {
      changed++
      if (!CHECK_ONLY) {
        fs.writeFileSync(file, transformed)
        console.log('updated', path.relative(ROOT, file))
      }
    }
  }

  if (CHECK_ONLY) {
    if (changed > 0) {
      console.error(`Found ${changed} file(s) still using barrel @babylonjs/core imports`)
      process.exit(1)
    }
    console.log('All Babylon imports use deep paths')
    return
  }

  console.log(`Updated ${changed} file(s)`)
}

main()
