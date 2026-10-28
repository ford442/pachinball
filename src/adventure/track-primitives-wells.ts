/**
 * Adventure track primitives for the `cone` and `axisPull` schema segments.
 *
 * Kept apart from track-primitives.ts (already the largest primitive module)
 * but built the same way: one mesh and one descriptor from one pose, so the
 * visual and the physics cannot drift. See docs/TRACK_SCHEMA.md.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'

import { axisPullFieldDesc, coneDesc } from './track-collider-descriptors'
import type { GeoQuat, GeoVec3 } from './track-geometry'
import type { TrackMaterial, TrackPrimitiveContext } from './track-primitives'

/**
 * A static cone, apex up, its base centred on `base`. ONE `cone` descriptor:
 * C++ `addStaticCone` on the owner path, Rapier `ColliderDesc.cone` on the
 * dev path.
 */
export function createStaticCone(
  ctx: TrackPrimitiveContext,
  base: GeoVec3,
  radius: number,
  halfHeight: number,
  rotation: GeoQuat,
  restitution: number,
  friction: number,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  const center = { x: base.x, y: base.y + halfHeight, z: base.z }
  const mesh = MeshBuilder.CreateCylinder(
    'staticCone',
    { diameterTop: 0, diameterBottom: radius * 2, height: halfHeight * 2, tessellation: 24 },
    ctx.scene
  )
  mesh.position.set(center.x, center.y, center.z)
  mesh.rotationQuaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
  mesh.material = material
  ctx.adventureTrack.push(mesh)

  const { body } = ctx.emit(
    coneDesc(center, halfHeight, radius, { rotation, restitution, friction, label: 'staticCone' })
  )
  ctx.adventureBodies.push(body)
}

/**
 * The Mag Spin well as track content: ONE `axisPullField` descriptor centred
 * on `center`. There is no body and no Rapier collider — the Rapier dev path
 * runs the track without the pull (and does not build the old feeder bowl).
 * The optional column is a faint, static tint (no flashing), so it needs no
 * reduced-motion or photosensitive path.
 */
export function createAxisPullWell(
  ctx: TrackPrimitiveContext,
  center: GeoVec3,
  radius: number,
  halfHeight: number,
  strength: number,
  enabled: boolean,
  visible: boolean,
  material: TrackMaterial
): void {
  if (!ctx.hasWorld) return

  ctx.emitField(axisPullFieldDesc(center, radius, halfHeight, strength, { enabled, label: 'axisPullWell' }))
  if (!visible) return

  const column = MeshBuilder.CreateCylinder(
    'axisPullWell',
    { diameter: radius * 2, height: halfHeight * 2, tessellation: 32 },
    ctx.scene
  )
  column.position.set(center.x, center.y, center.z)
  column.isPickable = false

  const tint = new StandardMaterial('axisPullWellMat', ctx.scene)
  tint.diffuseColor = Color3.Black()
  tint.emissiveColor = material.emissiveColor.clone()
  tint.alpha = enabled ? 0.1 : 0.04
  tint.backFaceCulling = false
  tint.disableLighting = true
  ctx.materials.push(tint)
  column.material = tint
  ctx.adventureTrack.push(column)
}
