/**
 * Minimal deterministic GLB 2.0 writer for generated cabinet / insert models.
 *
 * Input geometry is authored in Babylon world space (see mesh-primitives.mjs).
 * Babylon's glTF loader puts every file under a `__root__` that maps glTF
 * (x, y, z) to Babylon (−x, y, z). The writer applies the inverse — negate X
 * on positions and normals, reverse triangle winding — so a loaded model lands
 * exactly on its authored Babylon coordinates and its faces stay front-facing.
 *
 * Output: one node per entry, one primitive per node, PBR metallic-roughness
 * materials (optionally emissive with KHR_materials_emissive_strength). No
 * cameras, lights, textures or timestamps — the same input yields the same bytes.
 */

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const UNSIGNED_INT = 5125

const round = (v) => Math.round(v * 1e6) / 1e6

function pad4(buf, fill) {
  const rem = buf.length % 4
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)])
}

/**
 * @param {object} model
 * @param {{ name: string, geometry: {positions:number[],normals:number[],indices:number[]}, material: string }[]} model.nodes
 * @param {Record<string, { baseColor: number[], metallic?: number, roughness?: number,
 *   emissive?: number[], emissiveStrength?: number, doubleSided?: boolean }>} model.materials
 * @param {string} [model.generator]
 * @returns {Buffer}
 */
export function writeGlb({ nodes, materials, generator = 'pachinball scripts/lib/glb-writer.mjs' }) {
  const materialNames = Object.keys(materials)
  const materialIndex = new Map(materialNames.map((n, i) => [n, i]))
  let usesEmissiveStrength = false

  const gltfMaterials = materialNames.map((name) => {
    const m = materials[name]
    const mat = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: (m.baseColor.length === 4 ? m.baseColor : [...m.baseColor, 1]).map(round),
        metallicFactor: round(m.metallic ?? 0),
        roughnessFactor: round(m.roughness ?? 0.6),
      },
    }
    if (m.emissive) {
      mat.emissiveFactor = m.emissive.map(round)
      if (m.emissiveStrength && m.emissiveStrength !== 1) {
        mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: round(m.emissiveStrength) } }
        usesEmissiveStrength = true
      }
    }
    if (m.doubleSided) mat.doubleSided = true
    return mat
  })

  const bin = []
  let binLength = 0
  const bufferViews = []
  const accessors = []
  const meshes = []
  const gltfNodes = []

  const pushView = (buf, target) => {
    const padded = pad4(buf, 0)
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length, target })
    bin.push(padded)
    binLength += padded.length
    return bufferViews.length - 1
  }

  for (const node of nodes) {
    const { positions, normals, indices } = node.geometry
    if (!materialIndex.has(node.material)) throw new Error(`unknown material ${node.material} on ${node.name}`)
    const vertexCount = positions.length / 3
    if (vertexCount === 0) throw new Error(`empty geometry on ${node.name}`)

    const pos = new Float32Array(positions.length)
    const nrm = new Float32Array(normals.length)
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i += 3) {
      // Babylon → glTF: negate X.
      pos[i] = -positions[i]
      pos[i + 1] = positions[i + 1]
      pos[i + 2] = positions[i + 2]
      nrm[i] = -normals[i]
      nrm[i + 1] = normals[i + 1]
      nrm[i + 2] = normals[i + 2]
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k])
        max[k] = Math.max(max[k], pos[i + k])
      }
    }
    // The X mirror flips handedness; reverse winding to keep faces outward.
    const wide = vertexCount > 65535
    const idx = wide ? new Uint32Array(indices.length) : new Uint16Array(indices.length)
    for (let i = 0; i < indices.length; i += 3) {
      idx[i] = indices[i]
      idx[i + 1] = indices[i + 2]
      idx[i + 2] = indices[i + 1]
    }

    const posView = pushView(Buffer.from(pos.buffer), ARRAY_BUFFER)
    const nrmView = pushView(Buffer.from(nrm.buffer), ARRAY_BUFFER)
    const idxView = pushView(Buffer.from(idx.buffer), ELEMENT_ARRAY_BUFFER)
    accessors.push(
      { bufferView: posView, componentType: FLOAT, count: vertexCount, type: 'VEC3', min: min.map(Math.fround), max: max.map(Math.fround) },
      { bufferView: nrmView, componentType: FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: idxView, componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT, count: indices.length, type: 'SCALAR' },
    )
    const a = accessors.length - 3
    meshes.push({
      name: node.name,
      primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: materialIndex.get(node.material) }],
    })
    gltfNodes.push({ name: node.name, mesh: meshes.length - 1 })
  }

  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  }
  if (usesEmissiveStrength) json.extensionsUsed = ['KHR_materials_emissive_strength']

  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20)
  const binChunk = Buffer.concat(bin)
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(CHUNK_BIN, 4)
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
}
