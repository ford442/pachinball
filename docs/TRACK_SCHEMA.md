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
| `pinLattice` | `rows`, `cols`, `spacing`, `diameter`, `height`, optional `rowSpacing`, `rowOffset`, `startAlong`, `lateral`, `restitution`, `friction`, `dropout`, `dropoutSeed`, `holes`, `material` | `createPinLattice` on the previous straight — **one** C++ pin field |
| `forceField` | `size`, `accel`, optional `space`, `alongRamp` + `lateral` + `surfaceOffset` **or** `offset` + `yawDeg`, `visible`, `material` | `createForceField` — one C++ force field |

Cursor starts at `getTrackStartAnchor(id)` with heading `initialHeadingDeg` (default `0`).

`offset` (on `bucket`, `portal`, `gate`, `cylinder`, `resetBasin`, and `spinner` when set) is a **world-space** vector added to the
cursor — it does not rotate with heading. Gates in particular usually need a `y`
offset, or they sit buried in the running surface. When `spinner` omits `offset`, the compiler uses the legacy `(radius+1 along heading, y-1)` placement.

### C++ toys: `pinLattice` and `forceField` (#424)

Both build geometry the Rapier path never had, so prefer them over per-pin
`pinField` rows and TS impulse zones in new tracks.

**`pinLattice`** is a whole staggered lattice on the most recent `straight`,
exported as ONE `addPinField` handle however many pins it holds (the per-pin
`pinField` segment costs one static-cylinder slot per pin, from a family capped
at 1000). Rows run down the slope from `startAlong` (default `rowSpacing`),
columns across it, centred on `lateral` (default 0); odd rows shift by
`rowOffset` (default `spacing / 2`). Pins stand on the surface along the ramp
normal. Defaults: `rowSpacing = spacing`, `restitution` 0.6, `friction` 0.3.

- `holes: [{ row, col }]` leaves slots empty on purpose (a channel, room for a mill).
- `dropout` (in `[0, 1)`) with `dropoutSeed` (uint32) removes slots by a seeded
  hash that C++ and the visuals share bit-for-bit. Never `Math.random`.
- The validator refuses a lattice that does not fit on its ramp.
- Leave at least a ball's width (0.5) between the outer pins and the side walls,
  and do not line a pin up with the spawn line (x = start anchor). A ball dropped
  dead-centre on a pin balances there forever in a deterministic solver.
  `STORM_LATTICE` shifts its lattice a quarter pitch (`lateral: -0.375`) for exactly this.

**`forceField`** is an oriented box that adds `accel` (m/s², mass-independent
like gravity) to every ball inside it. That covers updrafts, crosswinds and
conveyors. It has two placements:

- *ramp-anchored* (`alongRamp` set): on the most recent `straight`, in the ramp
  frame. `size.x` runs across, `size.y` off the surface, `size.z` down the slope,
  and the centre sits `surfaceOffset` (default `size.y / 2`) above the surface.
- *cursor-anchored* (default): world `offset` from the cursor, yawed to the cursor
  heading plus `yawDeg`.

`space: "field"` expresses `accel` in that frame (`z` = down the slope for a
ramp-anchored field); the default `"world"` leaves it in world space. The
magnitude is capped at 60 m/s². `visible` (default true) draws a faint, static
translucent volume, so there is nothing to flash and no reduced-motion path is needed.

Force fields are **C++-only**: the Rapier dev path builds the track without them.
A field may make a track easier or livelier, but it must never be the only way
through.

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
| `pinField` (a whole lattice) | `fixed` | no | `addPinField` (one handle) |
| `forceField` (box, no body) | `fixed` | no | `addForceField` |

Rejected: `dynamic` bodies, a moving or sensor `convexMesh`, a moving, sensor
or attached `pinField` / `forceField`, attachments
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
| `pinLattice` | one `pinField` |
| `forceField` | one `forceField` |
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

**Campaign spine (JSON):** `NEON_HELIX`, `CYBER_CORE`, `QUANTUM_GRID`, `STORM_LATTICE`, `GLITCH_SPIRE`, `RETRO_WAVE_HILLS`, `HYPER_DRIFT`,
`CHRONO_CORE`, `SINGULARITY_WELL`, `CRYO_CHAMBER`, `FIREWALL_BREACH`. Optional branch: `PACHINKO_SPIRE`.

**Stage 5 (JSON, C++ toys only):** `STORM_LATTICE`. A 55° lattice board (one pin
field, 79 pins, a seeded dropout and a hole cleared for a mill) with two
ramp-anchored updraft shafts and two crosswinds that herd the ball toward the
goal basin. It is the reference for new schema content.

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
