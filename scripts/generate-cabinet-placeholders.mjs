#!/usr/bin/env node
/**
 * Generate dimension-matched placeholder GLBs for the classic cabinet.
 * Matches CLASSIC_CONFIG: width 32, depth 44, sideHeight 20, panelZ 5.
 * Node names follow neon/theme contracts (Neon, LightBar, Detail).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '../public/models/cabinet/classic')

/** Box centered at (cx,cy,cz) with half-extents hx,hy,hz → 24 floats positions + indices */
function boxGeometry(cx, cy, cz, hx, hy, hz) {
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz])

  // 6 faces × 4 verts (unique per face for flat normals)
  const faces = [
    [0, 1, 2, 3], // -Z
    [5, 4, 7, 6], // +Z
    [4, 0, 3, 7], // -X
    [1, 5, 6, 2], // +X
    [3, 2, 6, 7], // +Y
    [4, 5, 1, 0], // -Y
  ]
  const positions = []
  const indices = []
  let vi = 0
  for (const face of faces) {
    for (const ci of face) {
      positions.push(...corners[ci])
    }
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
    vi += 4
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) }
}

function align4(n) {
  return (n + 3) & ~3
}

function buildGlb(meshes) {
  // meshes: [{ name, positions, indices }]
  const binParts = []
  const accessors = []
  const bufferViews = []
  const glMeshes = []
  const nodes = []
  let binOffset = 0

  for (const mesh of meshes) {
    const posBytes = mesh.positions.byteLength
    const idxBytes = mesh.indices.byteLength
    const posPad = align4(posBytes) - posBytes
    const idxPad = align4(idxBytes) - idxBytes

    const posView = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: posBytes,
      target: 34962,
    })
    binParts.push(Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, posBytes))
    if (posPad) binParts.push(Buffer.alloc(posPad))
    binOffset += posBytes + posPad

    let min = [Infinity, Infinity, Infinity]
    let max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < mesh.positions.length; i += 3) {
      min[0] = Math.min(min[0], mesh.positions[i])
      min[1] = Math.min(min[1], mesh.positions[i + 1])
      min[2] = Math.min(min[2], mesh.positions[i + 2])
      max[0] = Math.max(max[0], mesh.positions[i])
      max[1] = Math.max(max[1], mesh.positions[i + 1])
      max[2] = Math.max(max[2], mesh.positions[i + 2])
    }

    const posAcc = accessors.length
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: mesh.positions.length / 3,
      type: 'VEC3',
      max,
      min,
    })

    const idxView = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset: binOffset,
      byteLength: idxBytes,
      target: 34963,
    })
    binParts.push(Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, idxBytes))
    if (idxPad) binParts.push(Buffer.alloc(idxPad))
    binOffset += idxBytes + idxPad

    const idxAcc = accessors.length
    accessors.push({
      bufferView: idxView,
      componentType: 5123,
      count: mesh.indices.length,
      type: 'SCALAR',
    })

    const meshIndex = glMeshes.length
    glMeshes.push({
      name: mesh.name,
      primitives: [
        {
          attributes: { POSITION: posAcc },
          indices: idxAcc,
          mode: 4,
        },
      ],
    })
    nodes.push({ name: mesh.name, mesh: meshIndex })
  }

  const binBuffer = Buffer.concat(binParts)
  const json = {
    asset: { version: '2.0', generator: 'pachinball-placeholder-cabinet' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: glMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.byteLength }],
  }

  let jsonStr = JSON.stringify(json)
  const jsonPad = align4(jsonStr.length) - jsonStr.length
  if (jsonPad) jsonStr += ' '.repeat(jsonPad)

  const jsonChunk = Buffer.from(jsonStr, 'utf8')
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4) // JSON

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binBuffer.byteLength, 0)
  binHeader.writeUInt32LE(0x004e4942, 4) // BIN\0

  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binBuffer.byteLength
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0) // glTF
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binBuffer])
}

// Outer shell ≈ width+sideThick*2 = 36, depth 44, height 20; center at panelZ=5, y = sideHeight/2 - 2 = 8
const body = {
  name: 'cabinetBody',
  ...boxGeometry(0, 8, 5, 18, 10, 22),
}
const neon = {
  name: 'cabinetNeonMarquee',
  ...boxGeometry(0, 18.5, 26, 10, 0.4, 0.4),
}
const lightBar = {
  name: 'cabinetLightBar',
  ...boxGeometry(0, 1, -14, 12, 0.25, 0.25),
}

mkdirSync(outDir, { recursive: true })
mkdirSync(join(__dirname, '../public/models/inserts'), { recursive: true })

const simpleGlb = buildGlb([body, neon, lightBar])
writeFileSync(join(outDir, 'simple.glb'), simpleGlb)

const detail = {
  name: 'cabinetSidePlateDetail',
  ...boxGeometry(-17.5, 8, 5, 0.3, 8, 18),
}
const highGlb = buildGlb([body, neon, lightBar, detail])
writeFileSync(join(outDir, 'high.glb'), highGlb)

writeFileSync(
  join(__dirname, '../public/models/inserts/.gitkeep'),
  '',
)

console.log(
  `Wrote classic placeholders: simple=${simpleGlb.byteLength}B high=${highGlb.byteLength}B → ${outDir}`,
)
