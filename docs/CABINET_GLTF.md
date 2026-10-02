# Cabinet glTF Pipeline

Classic cabinet shells can load from **glTF 2.0** (`.glb`) with a procedural fallback. Playfield colliders stay **code-authored / WASM descriptors** — never mesh-collide high-poly art.

## Asset layout

```
public/models/cabinet/classic/simple.glb   # LOW tier (and fallback)
public/models/cabinet/classic/high.glb     # MEDIUM / HIGH
public/models/inserts/prism-core/{simple,high}.glb
public/models/inserts/mag-spin/{simple,high}.glb
public/models/inserts/nano-loom/{simple,high}.glb
```

The classic cabinet is generated, not hand-exported — edit the generator, then
regenerate and check:

```bash
npm run models:classic-cabinet   # scripts/generate-classic-cabinet.mjs → classic/{simple,high}.glb
npm run models:mag-spin-insert   # scripts/generate-mag-spin-insert.mjs → inserts/mag-spin/{simple,high}.glb
npm run models:insert-placeholders   # Prism Core / Nano-Loom box placeholders
npm run models:check             # tests/model-budgets.test.ts
```

Generators share `scripts/lib/glb-writer.mjs` (deterministic GLB: positions,
normals, PBR + `KHR_materials_emissive_strength`, no cameras/lights) and
`scripts/lib/mesh-primitives.mjs` (chamfered boxes, prisms, lathes, tori).

### Authoring frame and handedness

Generators author in **Babylon world space** — the same numbers the procedural
builders use (`panelZ = 5`, front at z = −17, camera at −Z looking +Z).
Babylon's glTF loader parents every file under `__root__`, which maps glTF
(x, y, z) to Babylon (−x, y, z). The writer applies the inverse (negate X,
reverse winding), so a loaded model lands on its authored coordinates and its
faces stay front-facing. `cabinetCoinSlot` sits at x = −2 as the canary: if it
loads at +2, the handedness is wrong.

## LOD + QualityTier

| QualityTier | URL used |
|-------------|----------|
| `LOW` | `simpleUrl` only (never fetches high) |
| `MEDIUM` / `HIGH` | `highUrl`, then `simpleUrl` on failure |

Configured on the preset (`CLASSIC_CONFIG.gltf` in `src/cabinet/cabinet-presets.ts`).

## Load budgets

| Asset | Doc ceiling | Classic today | Enforced (`models:check`) |
|-------|-------------|---------------|---------------------------|
| `simple.glb` | ≤ ~1.5 MB, ≤ 2 s desktop / ≤ 4 s mid mobile | ~84 KB, ~1.7k tris | ≤ 250 KB, ≤ 4k tris |
| `high.glb` | ≤ ~8 MB | ~260 KB, ~7.4k tris | ≤ 3 MB, ≤ 60k tris |

Measure:

1. Chrome DevTools → Network → filter `.glb` → size + timing.
2. Or wrap load with `performance.now()` around `loadCabinetGltf` / SceneLoader.

Menu shows a progress overlay during classic load; **Start** stays disabled until the cabinet resolves (glTF **or** procedural fallback).

## Physics alignment

- Cabinet glTF is **visual-only** (`isPickable = false`).
- Ball containment remains [`src/objects/object-walls.ts`](../src/objects/object-walls.ts).
- World frame matches the procedural classic origin (`panelZ ≈ 5`, playfield x ±14, z −13…23); the body stays inside the procedural envelope (sides x ±16…18).
- The head is built around the backbox display (`DisplaySystem.createBackbox` at (0, 13.5, 26.5), 20 × 12) and the back panel stops below it (y 7), so the cabinet frames the display instead of hiding it.
- `CabinetGltfConfig.bounds` records the authored world AABB. `tests/model-budgets.test.ts` holds the files to it (±0.5); set `window.DEBUG_CABINET_ALIGN = true` before load to log the loaded AABB against it at runtime.
- A load that resolves after its timeout is disposed, not left in the scene.

## Blender → glTF checklist

1. Unit scale: **1 Blender unit = 1 game unit**; apply scale/rotation (`Ctrl+A`).
2. Export **glTF 2.0 Binary (`.glb`)**.
3. Y-up, −Z forward (Babylon default glTF orientation).
4. Do **not** rely on embedded cameras/lights for gameplay lighting (code still builds interior lights from `lightPoints`).
5. Keep exterior extents on `CabinetGltfConfig.bounds` (update it with the art).
6. **Node names** (substring contracts used by theme code):

| Purpose | Name must include |
|---------|-------------------|
| Neon trim | `Neon`, `Glow`, or `LightBar` |
| Decor / side accents | `Detail`, `Plate`, `Grille`, `Circuit`, `Inset`, or `Accent` |

Examples: `cabinetNeonMarquee`, `cabinetLightBar`, `cabinetSidePlateDetail`.

7. Theme code recolours `Circuit` / `SidePlate` emissives on either StandardMaterial or PBRMaterial; meshes may share materials.
8. Ship both LODs under the paths above; replacing the generated files needs no code changes (keep the node names in `CLASSIC_REQUIRED_NODES`).

## Runtime API

- Loader: `src/cabinet/cabinet-gltf-loader.ts` (`loadCabinetGltf`, `pickCabinetGltfUrl`, `loadOptionalInsert`).
- Orchestrator: `CabinetBuilder.loadCabinetPreset()` (async) tries glTF then procedural.
- Dependency: `@babylonjs/loaders` (side-effect import registers the glTF plugin).

## Inserts (playfield toys)

`src/cabinet/insert-gltf-loader.ts` loads visual-only insert meshes with the same
LOD rules as cabinet shells (`LOW` → `simple.glb`; `MEDIUM`/`HIGH` → `high.glb`
with simple fallback).

**Pilot wiring:** `PrismCoreFeeder`, `MagSpinFeeder`, and `NanoLoomFeeder` each call
`loadInsertGltf(tier)` to overlay `public/models/inserts/<toy-id>/{simple,high}.glb`
and hide procedural meshes when load succeeds. Mag-Spin hides only its well and
floor; the procedural spin rings and light stay for state feedback, so the insert
rim stays below them (y ≤ 0.3).

`attachInsertMeshes` moves the file's `__root__` to the toy anchor and leaves the
meshes under it. Insert art is authored relative to the anchor in Babylon space
(same handedness rule as the cabinet); node transforms survive. Colliders remain code-authored / WASM
descriptors in the feeder `createPhysics()` methods — never derive gameplay colliders
from insert art.

| Node name (substring) | Toy | Purpose |
|-----------------------|-----|---------|
| `prismCoreInner` | Prism Core | Inner chamber mesh |
| `prismCoreOuter` | Prism Core | Outer shell |
| `prismCoreShardDetail` | Prism Core | HIGH-only shard accent |
| `magSpinWell` | Mag-Spin | Turned bowl, inner radius 1.75 (`WELL_DIAMETER / 2`) |
| `magSpinFloor` | Mag-Spin | Well floor at y −0.45 |
| `magSpinFloorSpiral` | Mag-Spin | Emissive two-arm spiral on the floor |
| `magSpinRingDetail` | Mag-Spin | HIGH-only copper coil bobbins on the lip |
| `nanoLoomFrame` | Nano-Loom | Frame board |
| `nanoLoomIntake` | Nano-Loom | Intake |
| `nanoLoomPinDetail` | Nano-Loom | HIGH-only pin plate |

Export checklist matches cabinet shells (Y-up, −Z forward, 1 unit = 1 game unit).
Place assets under `public/models/inserts/<toy-id>/`.
