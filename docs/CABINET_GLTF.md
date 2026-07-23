# Cabinet glTF Pipeline

Classic cabinet shells can load from **glTF 2.0** (`.glb`) with a procedural fallback. Playfield **Rapier colliders stay code-authored** — never mesh-collide high-poly art.

## Asset layout

```
public/models/cabinet/classic/simple.glb   # LOW tier (and fallback)
public/models/cabinet/classic/high.glb     # MEDIUM / HIGH
public/models/inserts/                     # Optional insert hook (not wired yet)
```

Regenerate placeholders:

```bash
node scripts/generate-cabinet-placeholders.mjs
```

## LOD + QualityTier

| QualityTier | URL used |
|-------------|----------|
| `LOW` | `simpleUrl` only (never fetches high) |
| `MEDIUM` / `HIGH` | `highUrl`, then `simpleUrl` on failure |

Configured on the preset (`CLASSIC_CONFIG.gltf` in `src/cabinet/cabinet-classic.ts`).

## Load budgets (targets)

| Asset | Size budget | Cold load (local Vite) |
|-------|-------------|-------------------------|
| `simple.glb` | ≤ ~1.5 MB | ≤ 2 s desktop / ≤ 4 s mid mobile |
| `high.glb` | ≤ ~8 MB | same window when selected |

Measure:

1. Chrome DevTools → Network → filter `.glb` → size + timing.
2. Or wrap load with `performance.now()` around `loadCabinetGltf` / SceneLoader.

Menu shows a progress overlay during classic load; **Start** stays disabled until the cabinet resolves (glTF **or** procedural fallback).

## Physics alignment

- Cabinet glTF is **visual-only** (`isPickable = false`).
- Ball containment remains [`src/objects/object-walls.ts`](../src/objects/object-walls.ts).
- World frame must match the procedural classic origin (`panelZ ≈ 5`, dims from `CabinetPreset`: width 32, depth 44, sideHeight 20).
- Soft AABB check: set `window.DEBUG_CABINET_ALIGN = true` before load to log bbox vs preset.

## Blender → glTF checklist

1. Unit scale: **1 Blender unit = 1 game unit**; apply scale/rotation (`Ctrl+A`).
2. Export **glTF 2.0 Binary (`.glb`)**.
3. Y-up, −Z forward (Babylon default glTF orientation).
4. Do **not** rely on embedded cameras/lights for gameplay lighting (code still builds interior lights from `lightPoints`).
5. Keep exterior extents within ~4 units of `CabinetPreset` dims.
6. **Node names** (substring contracts used by theme code):

| Purpose | Name must include |
|---------|-------------------|
| Neon trim | `Neon`, `Glow`, or `LightBar` |
| Decor / side accents | `Detail`, `Plate`, `Grille`, `Circuit`, `Inset`, or `Accent` |

Examples: `cabinetNeonMarquee`, `cabinetLightBar`, `cabinetSidePlateDetail`.

7. Ship both LODs under the paths above; replace placeholders without code changes.

## Runtime API

- Loader: `src/cabinet/cabinet-gltf-loader.ts` (`loadCabinetGltf`, `pickCabinetGltfUrl`, `loadOptionalInsert`).
- Orchestrator: `CabinetBuilder.loadCabinetPreset()` (async) tries glTF then procedural.
- Dependency: `@babylonjs/loaders` (side-effect import registers the glTF plugin).

## Inserts (future)

`loadOptionalInsert(scene, 'models/inserts/…')` is exported for playfield toys. Not wired into bumpers/feeders in the classic pilot.
