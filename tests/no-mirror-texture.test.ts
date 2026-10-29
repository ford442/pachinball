import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * #484: the playfield mirror was allocated, kept honest across ball spawns and cabinet swaps, and
 * rendered 0 times at every measured commit, because Babylon only draws a MirrorTexture that an
 * active material samples and nothing did. It was deleted rather than kept for a later pass.
 *
 * If a material really needs a mirror, add the sampler in the same change and replace this guard
 * with a test that names that one material and asserts the mirror renders.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('no unsampled MirrorTexture', () => {
  it('src/ never imports or constructs a MirrorTexture', () => {
    const offenders = sourceFiles(join(__dirname, '..', 'src')).filter((file) =>
      /\bMirrorTexture\b/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
