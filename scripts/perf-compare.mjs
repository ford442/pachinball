#!/usr/bin/env node
/**
 * Compare two runs of the render-perf baseline (tests/perf-baseline.spec.ts) and
 * print percent deltas as a markdown table for docs/RENDER_BUDGET.md.
 *
 * Usage:
 *   node scripts/perf-compare.mjs <before> <after> [--dir test-results/perf]
 *
 * <before>/<after> are either paths to a single run JSON / a directory of them,
 * or a label: every `<dir>/<label>-<tier>-<state>.json` file is loaded.
 *
 * Report-only: always exits 0 unless the inputs cannot be read.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { compareRuns, formatMarkdown } from './perf-stats.mjs'

function loadRuns(arg, dir) {
  const asPath = resolve(arg)
  if (existsSync(asPath)) {
    if (statSync(asPath).isDirectory()) {
      return readdirSync(asPath)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(asPath, f), 'utf8')))
    }
    return [JSON.parse(readFileSync(asPath, 'utf8'))]
  }
  const labelDir = resolve(dir)
  if (!existsSync(labelDir)) throw new Error(`No such file, directory or label dir: ${arg} (${labelDir})`)
  const files = readdirSync(labelDir).filter((f) => f.startsWith(`${arg}-`) && f.endsWith('.json'))
  if (files.length === 0) throw new Error(`No run files for label "${arg}" in ${labelDir}`)
  return files.map((f) => JSON.parse(readFileSync(join(labelDir, f), 'utf8')))
}

function parseArgs(argv) {
  const positional = []
  let dir = 'test-results/perf'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dir = argv[++i] ?? dir
    else positional.push(argv[i])
  }
  return { positional, dir }
}

const { positional, dir } = parseArgs(process.argv.slice(2))
if (positional.length !== 2) {
  console.error(`Usage: node ${basename(process.argv[1])} <before> <after> [--dir test-results/perf]`)
  process.exit(2)
}

const before = loadRuns(positional[0], dir)
const after = loadRuns(positional[1], dir)
const { rows, warnings } = compareRuns(before, after)

console.log(`### ${positional[0]} → ${positional[1]}\n`)
console.log(formatMarkdown(rows))
if (warnings.length > 0) {
  console.log('\nWarnings:')
  for (const w of warnings) console.log(`- ${w}`)
}
