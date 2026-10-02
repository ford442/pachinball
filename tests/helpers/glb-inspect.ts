/**
 * Read-only GLB inspection for model budget tests: chunk parsing, accessor
 * decoding, and Babylon-space geometry (Babylon's glTF __root__ maps glTF
 * (x, y, z) to (−x, y, z)).
 */

export interface GltfJson {
  asset: { version: string; generator?: string }
  nodes: { name: string; mesh?: number }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[]
  materials?: { name?: string; emissiveFactor?: number[]; extensions?: Record<string, unknown> }[]
  accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
  cameras?: unknown[]
  extensionsUsed?: string[]
  extensions?: Record<string, unknown>
}

export interface Glb {
  json: GltfJson
  bin: Buffer
  byteLength: number
}

export function parseGlb(buf: Buffer): Glb {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  if (buf.readUInt32LE(4) !== 2) throw new Error('not glTF 2')
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson
  const binStart = 20 + jsonLen
  const binLen = buf.readUInt32LE(binStart)
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + binLen), byteLength: buf.length }
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

export function readAccessor(glb: Glb, index: number): Float32Array | Uint16Array | Uint32Array {
  const acc = glb.json.accessors[index]
  const view = glb.json.bufferViews[acc.bufferView]
  const offset = view.byteOffset ?? 0
  const n = acc.count * COMPONENTS[acc.type]
  const slice = glb.bin.buffer.slice(glb.bin.byteOffset + offset, glb.bin.byteOffset + offset + view.byteLength)
  if (acc.componentType === 5126) return new Float32Array(slice, 0, n)
  if (acc.componentType === 5123) return new Uint16Array(slice, 0, n)
  if (acc.componentType === 5125) return new Uint32Array(slice, 0, n)
  throw new Error(`unsupported componentType ${acc.componentType}`)
}

export function nodeNames(glb: Glb): string[] {
  return glb.json.nodes.map((n) => n.name)
}

function primitiveOf(glb: Glb, nodeName: string) {
  const node = glb.json.nodes.find((n) => n.name === nodeName)
  if (!node || node.mesh === undefined) throw new Error(`no mesh node ${nodeName}`)
  return glb.json.meshes[node.mesh].primitives
}

/** Triangle count over every primitive in the file. */
export function triangleCount(glb: Glb): number {
  let total = 0
  for (const mesh of glb.json.meshes) {
    for (const p of mesh.primitives) {
      total += (p.indices !== undefined ? glb.json.accessors[p.indices].count : glb.json.accessors[p.attributes.POSITION].count) / 3
    }
  }
  return total
}

/** Babylon-space AABB of one node (or the whole file when name is omitted). */
export function babylonBounds(glb: Glb, nodeName?: string): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const nodes = nodeName ? [nodeName] : glb.json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name)
  for (const name of nodes) {
    for (const p of primitiveOf(glb, name)) {
      const pos = readAccessor(glb, p.attributes.POSITION)
      for (let i = 0; i < pos.length; i += 3) {
        const v = [-pos[i], pos[i + 1], pos[i + 2]]
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], v[k])
          max[k] = Math.max(max[k], v[k])
        }
      }
    }
  }
  return { min, max }
}

/**
 * Signed volume of a node's triangles in glTF space (divergence theorem).
 * Positive for a closed surface wound counter-clockwise from outside — what
 * glTF expects for front faces.
 */
export function signedVolume(glb: Glb, nodeName: string): number {
  let vol = 0
  for (const p of primitiveOf(glb, nodeName)) {
    const pos = readAccessor(glb, p.attributes.POSITION)
    const idx = readAccessor(glb, p.indices!)
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3
      const b = idx[t + 1] * 3
      const c = idx[t + 2] * 3
      vol +=
        (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
          pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
          pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) /
        6
    }
  }
  return vol
}

/** Largest absolute difference between two GLBs' float payloads (same layout). */
export function maxBinaryDelta(a: Glb, b: Glb): number {
  if (a.bin.length !== b.bin.length) return Infinity
  let worst = 0
  for (let i = 0; i < a.json.accessors.length; i++) {
    const x = readAccessor(a, i)
    const y = readAccessor(b, i)
    for (let k = 0; k < x.length; k++) worst = Math.max(worst, Math.abs(x[k] - y[k]))
  }
  return worst
}
