/**
 * Pure layout maths for adventure-track primitives (#383).
 *
 * No Babylon, no Rapier — just the poses and extents a primitive occupies.
 * `track-primitives.ts` feeds each layout to BOTH the Babylon mesh it builds
 * and the collider descriptor it emits, so the visual and the physics can
 * never drift apart by recomputing the same trigonometry twice.
 */

export interface GeoVec3 {
  x: number
  y: number
  z: number
}

/** Unit horizontal direction for a Y heading (Babylon's sin/cos convention). */
export function headingForward(heading: number): GeoVec3 {
  return { x: Math.sin(heading), y: 0, z: Math.cos(heading) }
}

/** Unit horizontal right-hand vector for a Y heading. */
export function headingRight(heading: number): GeoVec3 {
  return { x: Math.cos(heading), y: 0, z: -Math.sin(heading) }
}

/** Surface normal of a ramp inclined by `inclineRad` along `heading`. */
export function rampNormal(heading: number, inclineRad: number): GeoVec3 {
  const h = headingForward(heading)
  return {
    x: h.x * Math.sin(inclineRad),
    y: Math.cos(inclineRad),
    z: h.z * Math.sin(inclineRad),
  }
}

/** Down-slope direction of a ramp inclined by `inclineRad` along `heading`. */
export function rampForward(heading: number, inclineRad: number): GeoVec3 {
  const h = headingForward(heading)
  return {
    x: h.x * Math.cos(inclineRad),
    y: -Math.sin(inclineRad),
    z: h.z * Math.cos(inclineRad),
  }
}

export function addScaled(a: GeoVec3, dir: GeoVec3, s: number): GeoVec3 {
  return { x: a.x + dir.x * s, y: a.y + dir.y * s, z: a.z + dir.z * s }
}

/** Half-thickness of every ramp slab — the mesh is 0.5 units tall. */
export const RAMP_HALF_THICKNESS = 0.25

export interface StraightRampLayout {
  /** Centre of the ramp slab. */
  center: GeoVec3
  /** Cursor position at the far end of the ramp. */
  endPos: GeoVec3
}

export function straightRampLayout(
  startPos: GeoVec3,
  heading: number,
  length: number,
  inclineRad: number
): StraightRampLayout {
  const hLen = length * Math.cos(inclineRad)
  const vDrop = length * Math.sin(inclineRad)
  const forward = headingForward(heading)

  const center = addScaled(startPos, forward, hLen / 2)
  center.y -= vDrop / 2

  const endPos = addScaled(startPos, forward, hLen)
  endPos.y -= vDrop

  return { center, endPos }
}

export interface CurvedRampSegment {
  center: GeoVec3
  /** Heading at the segment's midpoint — the yaw its slab is built with. */
  heading: number
}

export interface CurvedRampLayout {
  segments: CurvedRampSegment[]
  /** Chord length of one segment; the slab's depth. */
  chordLen: number
  endPos: GeoVec3
}

export function curvedRampLayout(
  startPos: GeoVec3,
  startHeading: number,
  radius: number,
  totalAngle: number,
  inclineRad: number,
  segments: number
): CurvedRampLayout {
  const segmentAngle = totalAngle / segments
  const arcLength = radius * Math.abs(segmentAngle)
  const chordLen = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2)
  const segmentDrop = arcLength * Math.sin(inclineRad)

  let currentHeading = startHeading
  let currentP: GeoVec3 = { ...startPos }
  const out: CurvedRampSegment[] = []

  for (let i = 0; i < Math.abs(segments); i++) {
    currentHeading += segmentAngle / 2

    const forward = headingForward(currentHeading)
    const center = addScaled(currentP, forward, chordLen / 2)
    center.y -= segmentDrop / 2

    out.push({ center, heading: currentHeading })

    currentP = addScaled(currentP, forward, chordLen)
    currentP.y -= segmentDrop

    currentHeading += segmentAngle / 2
  }

  return { segments: out, chordLen, endPos: currentP }
}

/** Half-width of the side-wall slabs, and their clearance past the track edge. */
export const WALL_HALF_THICKNESS = 0.25

/** Centres of the two side walls flanking a track segment. */
export function wallLayout(
  center: GeoVec3,
  heading: number,
  trackWidth: number,
  height: number
): GeoVec3[] {
  const right = headingRight(heading)
  return [trackWidth / 2 + WALL_HALF_THICKNESS, -trackWidth / 2 - WALL_HALF_THICKNESS].map(
    (offset) => {
      const pos = addScaled(center, right, offset)
      pos.y += height / 2
      return pos
    }
  )
}

/** One pin in a pin-field lattice, already lifted clear of the ramp surface. */
export function pinFieldLayout(
  rampStart: GeoVec3,
  heading: number,
  inclineRad: number,
  rampLength: number,
  pinSpacing: number,
  evenOffsets: readonly number[],
  oddOffsets: readonly number[],
  pinHeight: number
): GeoVec3[] {
  const forwardVec = rampForward(heading, inclineRad)
  const right = headingRight(heading)
  const normalVec = rampNormal(heading, inclineRad)

  const out: GeoVec3[] = []
  const rows = Math.floor(rampLength / pinSpacing) - 1
  for (let r = 1; r <= rows; r++) {
    const dist = r * pinSpacing
    const xOffsets = r % 2 === 0 ? evenOffsets : oddOffsets
    for (const xOff of xOffsets) {
      const pinPos = addScaled(addScaled(rampStart, forwardVec, dist), right, xOff)
      out.push(addScaled(pinPos, normalVec, RAMP_HALF_THICKNESS + pinHeight / 2))
    }
  }
  return out
}

export interface PlatformTooth {
  angle: number
  x: number
  z: number
}

/** Body-local placements of the teeth around a rotating platform's rim. */
export function platformToothLayout(radius: number, toothCount: number): PlatformTooth[] {
  const angleStep = (2 * Math.PI) / toothCount
  const out: PlatformTooth[] = []
  for (let i = 0; i < toothCount; i++) {
    if (i % 2 !== 0) continue
    const angle = i * angleStep
    out.push({
      angle,
      x: Math.sin(angle) * (radius - 0.25),
      z: Math.cos(angle) * (radius - 0.25),
    })
  }
  return out
}

/** Spin axis of an inclined mill: the ramp normal, not world Y. */
export function inclinedMillAxis(inclineRad: number, angVelAlongNormal: number): GeoVec3 {
  return {
    x: 0,
    y: Math.cos(inclineRad) * angVelAlongNormal,
    z: Math.sin(inclineRad) * angVelAlongNormal,
  }
}

export interface ConvexMeshLayout {
  /** 3 floats per vertex, body-local. */
  vertices: number[]
  /** 3 indices per triangle, wound CCW seen from outside the solid. */
  indices: number[]
}

/**
 * Closed triangular prism matching Babylon's `CreateCylinder({ tessellation: 3 })`
 * ring layout (vertex j at angle -j·120° in XZ, axis along local Y), so the
 * collider is exactly the prism that is drawn.
 *
 * Replaces prism-pathway's Rapier `convexHull`: two caps and three quad sides
 * make 8 outward-facing triangles, which the C++ engine takes as a one-sided
 * static mesh. Winding is fixed up per face against the solid's centre rather
 * than hand-ordered, so the outward guarantee does not rest on the angle
 * convention above.
 */
export function triangularPrismLayout(radius: number, height: number): ConvexMeshLayout {
  const halfHeight = height / 2
  const vertices: number[] = []
  for (const y of [-halfHeight, halfHeight]) {
    for (let j = 0; j < 3; j++) {
      const angle = (j * 2 * Math.PI) / 3
      vertices.push(Math.cos(-angle) * radius, y, Math.sin(-angle) * radius)
    }
  }

  // Bottom ring 0..2, top ring 3..5.
  const faces: Array<[number, number, number]> = [
    [0, 1, 2],
    [3, 4, 5],
  ]
  for (let j = 0; j < 3; j++) {
    const k = (j + 1) % 3
    faces.push([j, k, k + 3], [j, k + 3, j + 3])
  }

  const at = (i: number): GeoVec3 => ({ x: vertices[i * 3], y: vertices[i * 3 + 1], z: vertices[i * 3 + 2] })
  const indices: number[] = []
  for (const [a, b, c] of faces) {
    const pa = at(a)
    const pb = at(b)
    const pc = at(c)
    const e1 = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z }
    const e2 = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z }
    const n = {
      x: e1.y * e2.z - e1.z * e2.y,
      y: e1.z * e2.x - e1.x * e2.z,
      z: e1.x * e2.y - e1.y * e2.x,
    }
    // The prism is centred on the local origin, so a face's centroid is also
    // its outward direction.
    const outward = n.x * (pa.x + pb.x + pc.x) + n.y * (pa.y + pb.y + pc.y) + n.z * (pa.z + pb.z + pc.z)
    if (outward >= 0) indices.push(a, b, c)
    else indices.push(a, c, b)
  }

  return { vertices, indices }
}
