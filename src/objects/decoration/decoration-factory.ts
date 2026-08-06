import {
  Scene,
  Vector3,
  MeshBuilder,
  Mesh,
  StandardMaterial,
  Color3,
  TransformNode
} from '@babylonjs/core'
import { emissive, PALETTE, INTENSITY } from '../../game-elements/visual-language'

// ============================================================================
// NEXUS CASCADE — PREMIUM CYBER-NEON ARCADE AESTHETIC
// ============================================================================
// This section transforms the playfield into a high-end 2025 cyber-arcade
// cabinet. Everything here is 100% visual (no Rapier bodies, no colliders).
// All decoration respects the +18° playfieldGroup tilt via parenting.
//
// Design Language ("Nexus Cascade"):
//   • Primary power: Electric CYAN
//   • Data / secondary: Hot MAGENTA
//   • Premium / energy: Liquid GOLD
//   • Depth / mystery: Deep ULTRAVIOLET (PURPLE)
//   • Danger / warning: ALERT (orange-red)
//   • Bio / rare accents: MATRIX green
//
// Techniques: Decal API + low-poly emissive tubes/boxes/tori/pyramids,
// material sharing, INTENSITY constants, layered bloom-ready glows.
// ============================================================================

// -----------------------------------------------------------------------------
// Extended DecorationFactory — reusable visual building blocks
// -----------------------------------------------------------------------------

export class DecorationFactory {
  /**
   * Creates a glowing neon strut (thin vertical tech pillar).
   * Purely visual — no collider.
   */
  static createNeonStrut(name: string, scene: Scene, parent: TransformNode, pos: Vector3) {
    const strut = MeshBuilder.CreateCylinder(name, { height: 1.8, diameter: 0.08 }, scene)
    strut.parent = parent
    strut.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
    mat.diffuseColor = Color3.Black()
    strut.material = mat
    return strut
  }

  /**
   * Creates a small glowing tech node (indicator / junction box).
   * Purely visual — no collider.
   */
  static createTechNode(name: string, scene: Scene, parent: TransformNode, pos: Vector3) {
    const node = MeshBuilder.CreateBox(name, { size: 0.35 }, scene)
    node.parent = parent
    node.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.HIGH)
    node.material = mat
    return node
  }

  /**
   * Creates a faceted glowing crystal (holo-diamond / data shard).
   * Slightly rotated for interesting bloom highlights. Purely visual.
   */
  static createHoloCrystal(name: string, scene: Scene, parent: TransformNode, pos: Vector3, scale = 1.0, tint: string = PALETTE.GOLD) {
    const crystal = MeshBuilder.CreatePolyhedron(name, { type: 0, size: 0.22 * scale }, scene) // tetrahedron-ish
    crystal.parent = parent
    crystal.position = pos
    crystal.rotation.set(
      Math.random() * 0.8 + 0.3,
      Math.random() * Math.PI * 2,
      Math.random() * 0.6 + 0.4
    )

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(tint, INTENSITY.HIGH)
    mat.diffuseColor = Color3.Black()
    mat.disableLighting = true
    crystal.material = mat
    return crystal
  }

  /**
   * Creates a glowing neon ring (energy halo / data port).
   */
  static createNeonRing(name: string, scene: Scene, parent: TransformNode, pos: Vector3, diameter = 1.4, colorHex: string = PALETTE.CYAN) {
    const ring = MeshBuilder.CreateTorus(name, {
      diameter,
      thickness: 0.045,
      tessellation: 28
    }, scene)
    ring.parent = parent
    ring.position = pos
    ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.15

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(colorHex, INTENSITY.ACTIVE)
    mat.diffuseColor = Color3.Black()
    mat.disableLighting = true
    ring.material = mat
    return ring
  }

  /**
   * Creates a stylized "fiber optic" wire bundle (multiple parallel curved tubes).
   * Excellent for connecting clusters and adding organic cyber flow.
   */
  static createWireBundle(
    name: string,
    scene: Scene,
    parent: TransformNode,
    start: Vector3,
    end: Vector3,
    strands = 4,
    baseColor: string = PALETTE.CYAN
  ) {
    const bundle: Mesh[] = []
    const colors = [baseColor, PALETTE.MAGENTA, PALETTE.GOLD, PALETTE.PURPLE]

    for (let i = 0; i < strands; i++) {
      const offset = (i - (strands - 1) / 2) * 0.09
      const mid = new Vector3(
        (start.x + end.x) / 2 + offset * 0.6,
        start.y + 0.25 + Math.sin(i) * 0.08,
        (start.z + end.z) / 2 + offset * 0.3
      )

      const path = [start, mid, end]
      const wire = MeshBuilder.CreateTube(`${name}_s${i}`, {
        path,
        radius: 0.028 + (i % 2) * 0.008,
        tessellation: 5,
        cap: 2
      }, scene)

      wire.parent = parent
      const mat = new StandardMaterial(`${name}_mat_s${i}`, scene)
      mat.emissiveColor = emissive(colors[i % colors.length], 0.95 + i * 0.08)
      mat.diffuseColor = Color3.Black()
      mat.disableLighting = true
      wire.material = mat
      bundle.push(wire)
    }
    return bundle
  }

  /**
   * Creates a rectangular tech panel with subtle glowing seams.
   */
  static createTechPanel(name: string, scene: Scene, parent: TransformNode, pos: Vector3, size: Vector3, emissiveHex = PALETTE.PURPLE) {
    const panel = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene)
    panel.parent = parent
    panel.position = pos

    const mat = new StandardMaterial(`${name}-mat`, scene)
    mat.emissiveColor = emissive(emissiveHex, INTENSITY.NORMAL * 0.7)
    mat.diffuseColor = new Color3(0.02, 0.02, 0.04)
    panel.material = mat
    return panel
  }
}
