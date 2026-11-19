import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * `Game` is the object every feature used to thread through: ~118 public mutable fields and a dozen
 * `*Host` interfaces it implements. The way out (see "Lifecycle conventions" in CLAUDE.md) is small
 * service / context objects — `ArcadeOverlays`, `GameScreens` — that the register* stages build and
 * hosts receive instead of `Game`.
 *
 * This is the ratchet: neither number may go up. When a slice moves fields off `Game`, lower the
 * budget in the same change. The goal is half of the 118 this started from.
 */

/** Public, mutable, instance property declarations across the three classes that make up `Game`. */
const PUBLIC_MUTABLE_FIELD_BUDGET = 115
/** The `*Host` interfaces `Game` implements. A new feature takes a context object, not a new `Host` here. */
const HOST_INTERFACE_BUDGET = 12

function sourceOf(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)
}

function classesOf(sf: ts.SourceFile): ts.ClassDeclaration[] {
  return sf.statements.filter(ts.isClassDeclaration)
}

function publicMutableFields(path: string): string[] {
  const names: string[] = []
  for (const cls of classesOf(sourceOf(path))) {
    for (const member of cls.members) {
      if (!ts.isPropertyDeclaration(member)) continue
      const kinds = (ts.getModifiers(member) ?? []).map((m) => m.kind)
      if (
        kinds.includes(ts.SyntaxKind.PrivateKeyword) ||
        kinds.includes(ts.SyntaxKind.ProtectedKeyword) ||
        kinds.includes(ts.SyntaxKind.ReadonlyKeyword) ||
        kinds.includes(ts.SyntaxKind.StaticKeyword)
      ) {
        continue
      }
      names.push(member.name.getText())
    }
  }
  return names
}

describe('the surface of Game', () => {
  it('has no more public mutable fields than the budget (lower it when a slice lands)', () => {
    const fields = ['src/game.ts', 'src/game/game-fields.ts', 'src/game/game-delegates.ts'].flatMap(publicMutableFields)
    expect(
      fields.length,
      `Game has ${fields.length} public mutable fields (budget ${PUBLIC_MUTABLE_FIELD_BUDGET}). ` +
        'Put new state on the owning system, or on a small context object; if you moved fields off Game, lower the budget.',
    ).toBeLessThanOrEqual(PUBLIC_MUTABLE_FIELD_BUDGET)
  })

  it('implements no more *Host interfaces than the budget', () => {
    const game = classesOf(sourceOf('src/game.ts')).find((c) => c.name?.text === 'Game')
    const hosts = (game?.heritageClauses ?? [])
      .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
      .flatMap((h) => h.types.map((t) => t.expression.getText()))
    expect(
      hosts.length,
      `Game implements ${hosts.length} host interfaces (${hosts.join(', ')}); budget ${HOST_INTERFACE_BUDGET}. ` +
        'A new feature takes a context object built by a register* stage, not another Host on Game.',
    ).toBeLessThanOrEqual(HOST_INTERFACE_BUDGET)
  })

  it('moved the arcade overlays and the page screens off Game fields', () => {
    const fields = publicMutableFields('src/game/game-fields.ts')
    for (const gone of ['scoreElement', 'menuOverlay', 'pauseOverlay', 'startScreen', 'gameOverScreen', 'finalScoreElement']) {
      expect(fields).not.toContain(gone)
    }
    expect(fields).toContain('screens')
  })
})
