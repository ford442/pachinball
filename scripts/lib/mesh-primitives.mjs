/**
 * Geometry helpers for the generated cabinet / insert models.
 *
 * Geometry is authored in **Babylon world space** (left-handed, Y up, the
 * cabinet camera at −Z looking +Z). Triangles are wound so the standard cross
 * product (b − a) × (c − a) points out of the surface; glb-writer converts
 * both the handedness and the winding when it emits glTF.
 *
 * A geometry is { positions: number[], normals: number[], indices: number[] }.
 */

const EPS = 1e-9

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2])
  return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]
}

export function emptyGeometry() {
  return { positions: [], normals: [], indices: [] }
}

/**
 * Convex polygons (each a list of [x,y,z] points, any winding) with flat
 * normals. Each face is oriented away from `center`, which must lie inside
 * the convex solid. Degenerate faces are skipped.
 */
export function convexPolys(polys, center = [0, 0, 0]) {
  const g = emptyGeometry()
  for (let poly of polys) {
    if (poly.length < 3) continue
    let n = [0, 0, 0]
    for (let i = 1; i + 1 < poly.length; i++) {
      const c = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]))
      n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]]
    }
    if (Math.hypot(...n) < EPS) continue
    const centroid = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]).map((v) => v / poly.length)
    if (dot(n, sub(centroid, center)) < 0) {
      poly = [...poly].reverse()
      n = [-n[0], -n[1], -n[2]]
    }
    n = norm(n)
    const base = g.positions.length / 3
    for (const p of poly) {
      g.positions.push(p[0], p[1], p[2])
      g.normals.push(n[0], n[1], n[2])
    }
    for (let i = 1; i + 1 < poly.length; i++) g.indices.push(base, base + i, base + i + 1)
  }
  return g
}

/** Box centred at the origin with every edge chamfered by `bevel`. */
export function box(w, h, d, bevel = 0) {
  const hx = w / 2
  const hy = h / 2
  const hz = d / 2
  const b = Math.min(bevel, hx * 0.9, hy * 0.9, hz * 0.9)
  const P = (sx, sy, sz, axis) => {
    if (axis === 'x') return [sx * hx, sy * (hy - b), sz * (hz - b)]
    if (axis === 'y') return [sx * (hx - b), sy * hy, sz * (hz - b)]
    return [sx * (hx - b), sy * (hy - b), sz * hz]
  }
  const s = [-1, 1]
  const polys = []
  for (const sx of s) polys.push([P(sx, -1, -1, 'x'), P(sx, 1, -1, 'x'), P(sx, 1, 1, 'x'), P(sx, -1, 1, 'x')])
  for (const sy of s) polys.push([P(-1, sy, -1, 'y'), P(1, sy, -1, 'y'), P(1, sy, 1, 'y'), P(-1, sy, 1, 'y')])
  for (const sz of s) polys.push([P(-1, -1, sz, 'z'), P(1, -1, sz, 'z'), P(1, 1, sz, 'z'), P(-1, 1, sz, 'z')])
  if (b > 0) {
    for (const sx of s)
      for (const sy of s) polys.push([P(sx, sy, -1, 'x'), P(sx, sy, 1, 'x'), P(sx, sy, 1, 'y'), P(sx, sy, -1, 'y')])
    for (const sx of s)
      for (const sz of s) polys.push([P(sx, -1, sz, 'x'), P(sx, 1, sz, 'x'), P(sx, 1, sz, 'z'), P(sx, -1, sz, 'z')])
    for (const sy of s)
      for (const sz of s) polys.push([P(-1, sy, sz, 'y'), P(1, sy, sz, 'y'), P(1, sy, sz, 'z'), P(-1, sy, sz, 'z')])
    for (const sx of s) for (const sy of s) for (const sz of s) polys.push([P(sx, sy, sz, 'x'), P(sx, sy, sz, 'y'), P(sx, sy, sz, 'z')])
  }
  return convexPolys(polys)
}

/**
 * Right prism: a convex 2D outline in the (u, v) plane extruded `depth` along
 * the remaining axis. `plane` names the outline axes: 'zy' extrudes along X
 * (cabinet side wedges), 'xy' along Z, 'xz' along Y. Optional `bevel` insets
 * both caps so their rims are chamfered.
 */
export function prism(outline, depth, plane = 'xy', bevel = 0) {
  const map = {
    xy: (u, v, w) => [u, v, w],
    zy: (u, v, w) => [w, v, u],
    xz: (u, v, w) => [u, w, v],
  }[plane]
  const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length
  const cy = outline.reduce((a, p) => a + p[1], 0) / outline.length
  const inset = (p, k) => {
    if (k <= 0) return p
    const dx = p[0] - cx
    const dy = p[1] - cy
    const l = Math.hypot(dx, dy) || 1
    return [p[0] - (dx / l) * k, p[1] - (dy / l) * k]
  }
  const h = depth / 2
  const rings = bevel > 0 ? [[-h, bevel], [-h + bevel, 0], [h - bevel, 0], [h, bevel]] : [[-h, 0], [h, 0]]
  const ringPts = rings.map(([w, k]) => outline.map((p) => inset(p, k)).map(([u, v]) => map(u, v, w)))
  const polys = [ringPts[0], ringPts[ringPts.length - 1]]
  for (let r = 0; r + 1 < ringPts.length; r++) {
    const a = ringPts[r]
    const b = ringPts[r + 1]
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length
      polys.push([a[i], a[j], b[j], b[i]])
    }
  }
  return convexPolys(polys, map(cx, cy, 0))
}

/**
 * Surface of revolution about +Y. `profile` is a list of [radius, y] points;
 * consecutive points form bands. Normals are smoothed around the axis and
 * per band along the profile (sharp profile corners stay sharp).
 * `outward` false flips the surface (an inner wall seen from the axis).
 */
export function lathe(profile, segments = 32, { outward = true, phase = 0 } = {}) {
  const g = emptyGeometry()
  for (let k = 0; k + 1 < profile.length; k++) {
    const [r0, y0] = profile[k]
    const [r1, y1] = profile[k + 1]
    // Profile-plane normal of this band (pointing away from the axis for an outward band).
    let nr = y1 - y0
    let ny = -(r1 - r0)
    const l = Math.hypot(nr, ny) || 1
    nr /= l
    ny /= l
    if (!outward) {
      nr = -nr
      ny = -ny
    }
    const base = g.positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = phase + (i / segments) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      g.positions.push(r0 * c, y0, r0 * s, r1 * c, y1, r1 * s)
      g.normals.push(nr * c, ny, nr * s, nr * c, ny, nr * s)
    }
    for (let i = 0; i < segments; i++) {
      const a0 = base + i * 2
      const a1 = a0 + 1
      const b0 = a0 + 2
      const b1 = a0 + 3
      // Orient by the band normal: (b−a)×(c−a) must agree with it. Both
      // triangles contribute so a band touching the axis (one degenerate
      // triangle) still resolves.
      const p = (idx) => g.positions.slice(idx * 3, idx * 3 + 3)
      const n1 = cross(sub(p(b0), p(a0)), sub(p(a1), p(a0)))
      const n2 = cross(sub(p(b0), p(a1)), sub(p(b1), p(a1)))
      const n = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]]
      const want = g.normals.slice(a0 * 3, a0 * 3 + 3)
      if (dot(n, want) < 0) {
        g.indices.push(a0, a1, b0, a1, b1, b0)
      } else {
        g.indices.push(a0, b0, a1, a1, b0, b1)
      }
    }
  }
  return g
}

/** Flat disc (annulus when rInner > 0) at y, facing +Y (`up`) or −Y. */
export function disc(rOuter, rInner = 0, y = 0, segments = 32, up = true) {
  const g = emptyGeometry()
  const ny = up ? 1 : -1
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    g.positions.push(rOuter * c, y, rOuter * s, rInner * c, y, rInner * s)
    g.normals.push(0, ny, 0, 0, ny, 0)
  }
  for (let i = 0; i < segments; i++) {
    const o0 = i * 2
    const i0 = o0 + 1
    const o1 = o0 + 2
    const i1 = o0 + 3
    // Around +Y with angle a = atan2(z, x): (o1−o0)×(i0−o0) points −Y.
    if (up) g.indices.push(o0, i0, o1, i0, i1, o1)
    else g.indices.push(o0, o1, i0, i0, o1, i1)
  }
  return g
}

/** Capped cylinder / frustum about +Y, centred on the origin. */
export function cylinder(rTop, rBottom, height, segments = 24) {
  const h = height / 2
  return merge(
    lathe([[rBottom, -h], [rTop, h]], segments),
    disc(rTop, 0, h, segments, true),
    disc(rBottom, 0, -h, segments, false),
  )
}

/** Torus about +Y: ring radius R, tube radius r. */
export function torus(R, r, segments = 32, sides = 12) {
  const g = emptyGeometry()
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let j = 0; j <= sides; j++) {
      const b = (j / sides) * Math.PI * 2
      const cb = Math.cos(b)
      const sb = Math.sin(b)
      g.positions.push((R + r * cb) * ca, r * sb, (R + r * cb) * sa)
      g.normals.push(cb * ca, sb, cb * sa)
    }
  }
  const row = sides + 1
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * row + j
      const b = a + row
      const p = (idx) => g.positions.slice(idx * 3, idx * 3 + 3)
      const n = cross(sub(p(b), p(a)), sub(p(a + 1), p(a)))
      const want = g.normals.slice(a * 3, a * 3 + 3)
      if (dot(n, want) >= 0) g.indices.push(a, b, a + 1, a + 1, b, b + 1)
      else g.indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  return g
}

function rotMatrix([rx, ry, rz]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)]
  // R = Rz · Ry · Rx (X applied first).
  return [
    [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
    [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
    [-sy, sx * cy, cx * cy],
  ]
}

/** Scale, then rotate (radians, X then Y then Z), then translate. */
export function transform(geom, { t = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = rotMatrix(r)
  const out = { positions: [], normals: [], indices: [...geom.indices] }
  const flip = s[0] * s[1] * s[2] < 0
  for (let i = 0; i < geom.positions.length; i += 3) {
    const p = [geom.positions[i] * s[0], geom.positions[i + 1] * s[1], geom.positions[i + 2] * s[2]]
    // Normals transform by the inverse-transpose: divide by scale.
    const n0 = [geom.normals[i] / s[0], geom.normals[i + 1] / s[1], geom.normals[i + 2] / s[2]]
    const rp = m.map((row) => dot(row, p))
    const rn = norm(m.map((row) => dot(row, n0)))
    out.positions.push(rp[0] + t[0], rp[1] + t[1], rp[2] + t[2])
    out.normals.push(rn[0], rn[1], rn[2])
  }
  if (flip) {
    for (let i = 0; i < out.indices.length; i += 3) {
      const tmp = out.indices[i + 1]
      out.indices[i + 1] = out.indices[i + 2]
      out.indices[i + 2] = tmp
    }
  }
  return out
}

export function merge(...geoms) {
  const out = emptyGeometry()
  for (const g of geoms.flat()) {
    const base = out.positions.length / 3
    out.positions.push(...g.positions)
    out.normals.push(...g.normals)
    for (const i of g.indices) out.indices.push(i + base)
  }
  return out
}

export function triangleCount(geom) {
  return geom.indices.length / 3
}
