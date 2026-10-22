import { describe, expect, it } from 'vitest'
import { addToMirror, removeFromMirror, type MirrorRenderListHolder } from '../src/game-elements/mirror-render-list'
import { resolveMirrorRefreshRate } from '../src/game/mirror-config'
import { QualityTier } from '../src/game-elements/visual-language'

const mesh = (name: string) => ({ name }) as never

function holder(list: unknown[] | null): MirrorRenderListHolder {
  return { renderList: list as never }
}

describe('mirror render list helpers', () => {
  it('addToMirror treats the list as a set', () => {
    const a = mesh('a')
    const mirror = holder([])
    addToMirror(mirror, a)
    addToMirror(mirror, a)
    expect(mirror.renderList).toEqual([a])
  })

  it('removeFromMirror removes only the given mesh and reports whether it was listed', () => {
    const [a, b] = [mesh('a'), mesh('b')]
    const mirror = holder([a, b])
    expect(removeFromMirror(mirror, a)).toBe(true)
    expect(mirror.renderList).toEqual([b])
    expect(removeFromMirror(mirror, a)).toBe(false)
  })

  it.each([null, undefined])('tolerates a missing mirror (%s)', (mirror) => {
    expect(() => addToMirror(mirror, mesh('a'))).not.toThrow()
    expect(removeFromMirror(mirror, mesh('a'))).toBe(false)
  })

  it('tolerates a mirror whose render list is null', () => {
    const mirror = holder(null)
    addToMirror(mirror, mesh('a'))
    expect(removeFromMirror(mirror, mesh('a'))).toBe(false)
    expect(mirror.renderList).toBeNull()
  })
})

describe('resolveMirrorRefreshRate', () => {
  it('refreshes every frame on HIGH and every second frame below it', () => {
    expect(resolveMirrorRefreshRate(QualityTier.HIGH)).toBe(1)
    expect(resolveMirrorRefreshRate(QualityTier.MEDIUM)).toBe(2)
    expect(resolveMirrorRefreshRate(QualityTier.LOW)).toBe(2)
  })
})
