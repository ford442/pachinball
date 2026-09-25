# Adventure Track Schema (v1)

Declarative JSON track definitions compile to existing `TrackBuilder` geometry.
Campaign goals, timers, and rewards stay in `TRACK_CATALOG` — the schema covers
layout and presentation overrides only.

Related: GitHub **#296** (track DSL). Load path: `loadPlayfield()` →
`AdventureMode.switchToTrack()`.

## Authoring location

Ship JSON under:

```text
src/adventure/track-data/<TRACK_ID>.json
```

Files are loaded eagerly via `import.meta.glob` (synchronous `buildTrack`).
`TRACK_ID` must already exist as an `AdventureTrackType` / catalog key.

## Document shape

```json
{
  "schemaVersion": 1,
  "id": "GLITCH_SPIRE",
  "themeProfile": "GLITCH_SPIRE",
  "cameraPresetId": "GLITCH_SPIRE",
  "gravityMultiplier": 1,
  "materials": {
    "structure": "#FF00FF"
  },
  "segments": []
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `schemaVersion` | yes | Must be `1` |
| `id` | yes | `AdventureTrackType` value |
| `themeProfile` | no | Preferred theme profile id for material roles |
| `cameraPresetId` | no | Key into `CAMERA_PRESETS` (defaults to `id`) |
| `gravityMultiplier` | no | Scales world gravity for this track; default `1` |
| `initialHeadingDeg` | no | Compiler cursor heading in degrees; default `0`. `NEON_HELIX` uses `180`. |
| `materials` | no | Optional hex overrides per role |
| `segments` | yes | Non-empty ordered list |

Angles in JSON are **degrees**. The compiler converts to radians.

### Material refs

Segment `material` may be:

- A theme role: `structure` | `accent` | `energy` | `glow`
- A hex color: `#rrggbb`

Roles resolve via `getThemedTrackMaterial` / track theme profiles.

## Segments

| `type` | Fields | Builder call |
|--------|--------|--------------|
| `straight` | `width`, `length`, `inclineDeg`, optional `material`, `wallHeight`, `friction` | `addStraightRamp` |
| `curve` | `radius`, `angleDeg`, `inclineDeg`, `width`, optional `wallHeight`, `bankingDeg`, `segments`, `material`, `friction` | `addCurvedRamp` |
| `gap` | `length`, `drop` (positive = down) | Cursor only |
| `turn` | `deltaHeadingDeg` | Cursor heading += delta |
| `bucket` | optional `material`, `offset` `{x,y,z}` | `createBasin` |
| `portal` | optional `offset` | `addExitPortal` |
| `spinner` | `radius`, `angVelDeg`, optional `teeth`, `advance`, `offset`, `material` | `createRotatingPlatform` |
| `gate` | `color`: `RED` \| `GREEN` \| `BLUE`, optional `offset` | `createChromaGate` |
| `cylinder` | `diameter`, `height`, optional `offset`, `material` | `createStaticCylinder` |
| `pinField` | `spacing`, `evenOffsets`, `oddOffsets`, `diameter`, `height`, optional `material` | `createPinField` on the previous straight |
| `mill` | `alongRamp`, `lateral`, `radius`, `angVel` (rad/s along ramp normal), optional `surfaceOffset`, `material` | `createInclinedMill` |
| `resetBasin` | optional `offset`, `material` | `createResetBasin` |

Cursor starts at `getTrackStartAnchor(id)` with heading `initialHeadingDeg` (default `0`).

`offset` (on `bucket`, `portal`, `gate`, `cylinder`, `resetBasin`, and `spinner` when set) is a **world-space** vector added to the
cursor — it does not rotate with heading. Gates in particular usually need a `y`
offset, or they sit buried in the running surface. When `spinner` omits `offset`, the compiler uses the legacy `(radius+1 along heading, y-1)` placement.

`gap` accepts negative `length` and `drop`, which is the idiomatic way to nudge the
cursor backwards or upwards before a segment whose builder call has a fixed offset
of its own (see `CHRONO_CORE.json`, where a `-0.5 / -1` gap lines the second gear up
with the position its original TypeScript builder used).

## Collider vocabulary (WASM export contract)

Every track must run on `wasm-owner` with Rapier unstepped. Builders emit
`AdventureColliderDesc` descriptors (`src/adventure/track-collider-descriptors.ts`),
and `exportAdventureCollidersToWasm` (`src/game/physics/wasm-adventure-export.ts`)
walks them into the C++ engine. A descriptor it cannot place is reported
`unsupported`, and a track with any `unsupported` entry falls back to Rapier.
**That is the whole vocabulary — nothing outside this table ships:**

| Descriptor `kind` | Body `motion` | Sensor? | C++ call |
|-------------------|---------------|---------|----------|
| `box` / `cylinder` / `sphere` | `fixed` | no | `addStaticBox` / `addStaticCylinder` / `addStaticSphere` |
| `box` / `cylinder` / `sphere` | `fixed` | yes | `addSensorVolume` |
| `box` / `cylinder` / `sphere` | `kinematic-position` / `kinematic-velocity` | no | `addKinematicMover` (pose driven per tick) |
| `box` / `cylinder` / `sphere` | `kinematic-position` / `kinematic-velocity` | yes | moving sensor, overlap-tested analytically by `WasmOwner` |
| `convexMesh` (closed, CCW) | `fixed` | no | `addStaticTriangleMesh` |

Rejected: `dynamic` bodies, a moving or sensor `convexMesh`, attachments
nested more than one level deep (`parentIndex` on a parent), and any Rapier
collider built outside the descriptor path (`markUnexportedCollider`). There is
no capsule descriptor, no general hull, and no trimesh beyond closed convex
solids. Widen this only in C++ first, with a Catch2 test, then here.

Every JSON segment type above compiles to this vocabulary:

| Segment | Descriptors |
|---------|-------------|
| `straight`, `curve` | fixed boxes (ramp + optional walls) |
| `bucket` | fixed boxes + goal sensor box |
| `resetBasin` | fixed box + sensor box |
| `cylinder`, `pinField` | fixed cylinders |
| `spinner` | `kinematic-velocity` cylinder, optional attached box teeth |
| `mill` | `kinematic-velocity` cylinder |
| `gate` | fixed cylinder sensor (chroma recolour on overlap) |
| `portal`, `gap`, `turn` | none (portal sensor is created on activation) |

`npm run tracks:validate` enforces the contract: it builds every JSON track
through the real `TrackBuilder.buildFromDefinition` path
(`tests/helpers/track-export-harness.ts`) and fails any track whose descriptor
list has an `unsupported` entry or an unexported Rapier collider.

## Runtime behavior

1. If `id` has a JSON definition, `validateTrackDefinition` runs **before**
   `clearTrack()`.
2. Invalid data → `switchToTrack` returns `false`, prior geometry stays intact,
   HUD shows a soft error via `uiManager.showMessage`.
3. Valid data → tear down → `buildFromDefinition` → collision groups.

Hand-tuned flagships that still need custom gizmos (`PACHINKO_HALL`, `TESLA_TOWER`, `CASINO_HEIST`) remain TypeScript builders. `NEON_HELIX`, `CYBER_CORE`, and `PACHINKO_SPIRE` are JSON + `buildKind: 'json'`.

## Shipped data tracks

**Campaign spine (JSON):** `NEON_HELIX`, `CYBER_CORE`, `QUANTUM_GRID`, `GLITCH_SPIRE`, `RETRO_WAVE_HILLS`, `HYPER_DRIFT`,
`CHRONO_CORE`, `SINGULARITY_WELL`, `CRYO_CHAMBER`, `FIREWALL_BREACH`. Optional branch: `PACHINKO_SPIRE`.

**Post-finale branch (JSON):** `TIDAL_NEXUS` → `SOLAR_FLARE` → `DIGITAL_ZEN_GARDEN`.

`QUANTUM_GRID` and `CHRONO_CORE` were migrated from TypeScript in #321; the three spine
tracks above were migrated in the content-foundation slice with the same parity pattern.

A migration is only sound if the compiled JSON reproduces the original geometry.
`tests/track-json-migration-parity.test.ts` records the `TrackBuilder` call
sequence from a frozen copy of each original builder and from the compiled JSON,
then asserts the two are identical. Do a migration that way rather than by eye.

> `QUANTUM_GRID`'s builder branched on `modeType`. Its catalog entry pins it to
> `EXTENDED_MAP`, so only that branch ever ran; the JSON captures it and the
> unreachable `STATIONARY_TABLE` variant is gone.

## Adding a data track

1. Author `src/adventure/track-data/MY_TRACK.json` with `id` matching an existing enum value.
2. Point the track's manifest at it: `buildKind: 'json'` + `dataPath: './track-data/MY_TRACK.json'`.
3. If it replaces a TS builder, delete the builder and its `src/adventure/index.ts` export,
   and add a parity case before deleting anything.
4. Run `npm run tracks:validate` and `npm test`.

## Validation

- Runtime: `validateTrackDefinition()` in `src/adventure/track-schema.ts`
- CLI: `npm run tracks:validate` (wraps `tests/tracks-validate-cli.test.ts`)
- CI / local: `tests/track-schema.test.ts`, `tests/track-json-migration-parity.test.ts`
