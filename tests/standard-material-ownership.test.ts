import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * #524: `MaterialLibrary` owns the PBR set and `src/materials/material-basic.ts` owns every other
 * `StandardMaterial`; the cabinet presets keep theirs. ESLint (`no-restricted-syntax`) is the
 * enforcement; this is the same rule as a plain text scan, so editing the lint config cannot
 * quietly widen it. It also pins the directories the acceptance names.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const SRC = join(__dirname, '..', 'src')
const ALLOWED = ['materials', 'cabinet']

function constructors(): string[] {
  return sourceFiles(SRC).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const rel = relative(SRC, file).split(sep)
    return /\bnew\s+StandardMaterial\s*\(/.test(text) ? [rel.join('/')] : []
  })
}

describe('StandardMaterial construction (#524)', () => {
  it('happens only under src/materials/ and src/cabinet/', () => {
    const offenders = constructors().filter((rel) => !ALLOWED.includes(rel.split('/')[0] ?? ''))
    expect(offenders).toEqual([])
  })

  it.each(['effects', 'objects', 'game-elements', 'display', 'adventure', 'game'])(
    'does not appear under src/%s',
    (dir) => {
      expect(constructors().filter((rel) => rel.startsWith(`${dir}/`))).toEqual([])
    },
  )

  it('src/materials builds it in material-basic.ts (and the library files that predate it)', () => {
    const inMaterials = constructors().filter((rel) => rel.startsWith('materials/'))
    // The one helper every new call site uses must be among them.
    expect(inMaterials).toContain('materials/material-basic.ts')
  })
})
