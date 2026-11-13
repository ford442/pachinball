/**
 * Every Playwright spec is run by some workflow (#519 A). The nightly runs every spec the dev
 * config (playwright.config.ts) matches; the specs that config ignores because they need another
 * one (the preview bundle, the no-WASM degrade server) must be named in ci.yml.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const specs = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.spec.ts')).sort()

/** The dev config's OTHER_CONFIG_SPECS globs (`**\/name.spec.ts` / `**\/prefix-*.spec.ts`) as regexes. */
function otherConfigPatterns(): RegExp[] {
  const config = read('playwright.config.ts')
  const block = /const OTHER_CONFIG_SPECS = \[([\s\S]*?)\]/.exec(config)?.[1]
  if (!block) throw new Error('playwright.config.ts: OTHER_CONFIG_SPECS not found')
  return [...block.matchAll(/'\*\*\/([^']+)'/g)].map((m) => {
    const glob = m[1] ?? ''
    return new RegExp(`^${glob.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`)
  })
}

describe('Playwright spec coverage', () => {
  it('the nightly runs the whole dev-config suite', () => {
    const nightly = read('.github/workflows/nightly.yml')
    expect(nightly).toMatch(/run: npx playwright test --shard=/)
    // No file filter, no --grep: the shard covers everything the config matches.
    expect(nightly).not.toMatch(/npx playwright test --shard=\S+ \S+\.spec\.ts/)
  })

  it('every spec the dev config ignores is named in ci.yml', () => {
    const patterns = otherConfigPatterns()
    const ci = read('.github/workflows/ci.yml')
    const ignored = specs.filter((spec) => patterns.some((re) => re.test(spec)))
    expect(ignored.length).toBeGreaterThan(0)
    const missing = ignored.filter((spec) => !ci.includes(`tests/${spec}`) && !(spec === 'physics-degrade.spec.ts' && ci.includes('playwright.degrade.config.ts')))
    expect(missing, `specs no workflow runs: ${missing.join(', ')}`).toEqual([])
  })

  it('the WebGPU guards are in the blocking smoke job', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('tests/webgpu-no-glslang.spec.ts')
    expect(ci).toContain('tests/webgpu-boot.spec.ts')
  })
})
