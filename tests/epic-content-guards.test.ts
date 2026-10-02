/**
 * Content-epic guards: new content must not reach for Rapier, Rapier-only
 * shapes, or unseeded randomness. Existing sites are allowlisted; a new one
 * fails here instead of slipping into review.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

const rel = (p: string) => relative(ROOT, p).split('\\').join('/')
/** Source with // and /* *\/ comments blanked, so prose mentioning an API does not count. */
const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SRC = walk(join(ROOT, 'src'), ['.ts', '.tsx'])

function filesMatching(files: string[], pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(code(f))).map(rel).sort()
}

describe('Rapier stays behind the loader', () => {
  it('only rapier-loader.ts imports the Rapier module at runtime', () => {
    expect(filesMatching(SRC, /import\(\s*['"]@dimforge\/rapier3d-compat['"]\s*\)/)).toEqual([
      'src/game-elements/rapier-loader.ts',
    ])
  })

  it('static imports of Rapier are type-only and limited to the loader and the legacy world', () => {
    expect(filesMatching(SRC, /from\s+['"]@dimforge\/rapier3d-compat['"]/)).toEqual([
      'src/game-elements/physics.ts',
      'src/game-elements/rapier-loader.ts',
    ])
    expect(filesMatching(SRC, /import\s+(?!type\b)[^;]*from\s+['"]@dimforge\/rapier3d-compat['"]/)).toEqual([])
  })

  it('adds no Rapier cone or convex-hull colliders', () => {
    expect(filesMatching(SRC, /ColliderDesc\.cone\s*\(/)).toEqual(['src/objects/object-ball-traps.ts'])
    expect(filesMatching(SRC, /ColliderDesc\.convexHull\s*\(/)).toEqual(['src/adventure/track-collider-emitter.ts'])
  })
})

describe('content stays deterministic and C++-shaped', () => {
  const scoped = [
    ...walk(join(ROOT, 'src/adventure/track-data'), ['.json']),
    ...walk(join(ROOT, 'src/adventure/manifests'), ['.ts']),
    ...walk(join(ROOT, 'src/cascade'), ['.ts']),
    join(ROOT, 'src/display/display-character.ts'),
    ...walk(join(ROOT, 'scripts/lib'), ['.mjs']),
    ...[
      'generate-classic-cabinet.mjs',
      'generate-mag-spin-insert.mjs',
      'generate-insert-placeholders.mjs',
      'generate-nexus-character-pack.mjs',
    ].map((f) => join(ROOT, 'scripts', f)),
  ]

  it('scoped content never calls Math.random or builds cone / hull colliders', () => {
    expect(scoped.length).toBeGreaterThan(20)
    expect(filesMatching(scoped, /Math\.random\s*\(/)).toEqual([])
    expect(filesMatching(scoped, /\.cone\s*\(|convexHull/)).toEqual([])
    expect(filesMatching(scoped, /@dimforge\/rapier3d-compat/)).toEqual([])
  })

  it('every JSON pin lattice with dropout names its seed', () => {
    for (const file of walk(join(ROOT, 'src/adventure/track-data'), ['.json'])) {
      const track = JSON.parse(readFileSync(file, 'utf8')) as { segments: { type: string; dropout?: number; dropoutSeed?: number }[] }
      for (const seg of track.segments) {
        if (seg.type === 'pinLattice' && (seg.dropout ?? 0) > 0) {
          expect(Number.isInteger(seg.dropoutSeed), `${rel(file)} pinLattice dropoutSeed`).toBe(true)
        }
      }
    }
  })
})
