/**
 * Mirror-texture render list upkeep.
 *
 * Babylon removes a disposed mesh from every shadow map's render list but NOT from a
 * MirrorTexture's (AbstractMesh.dispose only walks `light.getShadowGenerators()`), so a
 * collected ball stayed in `mirror.renderList` forever: the array grew by one per ball and kept
 * every disposed mesh (and what it references) reachable. All mutation goes through here so the
 * list stays a set and an entry leaves it before its mesh is disposed.
 */

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'

/** The slice of MirrorTexture this module touches (also what tests fake). */
export interface MirrorRenderListHolder {
  renderList: AbstractMesh[] | null
}

/** Add `mesh` unless it is already listed. No-op without a mirror or a render list. */
export function addToMirror(mirror: MirrorRenderListHolder | null | undefined, mesh: AbstractMesh): void {
  const list = mirror?.renderList
  if (!list || list.includes(mesh)) return
  list.push(mesh)
}

/** Remove `mesh`. Returns whether it was listed. Call before `mesh.dispose()`. */
export function removeFromMirror(mirror: MirrorRenderListHolder | null | undefined, mesh: AbstractMesh): boolean {
  const list = mirror?.renderList
  if (!list) return false
  const index = list.indexOf(mesh)
  if (index === -1) return false
  list.splice(index, 1)
  return true
}
