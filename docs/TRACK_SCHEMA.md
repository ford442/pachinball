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

Every adventure track is one of these files (the TS track modules were converted
in #505 §A). They load lazily: `src/adventure/track-data-registry.ts` holds a
non-eager `import.meta.glob`, so each file is its own `assets/track-data-<ID>-*.js`
chunk, fetched the first time the track is built (`loadDataTrackDefinition`) and
parsed then with the Valibot schema (`src/schemas/track.ts`, itself a lazy chunk).
Whether a track exists and where its file lives are answered from the glob's keys,
so the entry chunk carries neither the data nor the schema. The service worker
precaches the track chunks (all 29 are ~34 KiB), so every track plays offline.
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
| `cone` | `radius`, `halfHeight`, optional `offset`, `yawDeg`, `restitution` (0.5), `friction` (0.3), `material` | `createStaticCone` (`track-primitives-wells.ts`) — one C++ `addStaticCone` handle |
| `axisPull` | `radius`, `strength`, optional `offset`, `axis` (±Y only), `halfHeight` (1), `enabled` (true), `visible` (true), `material` | `createAxisPullWell` (`track-primitives-wells.ts`) — one C++ axis-pull force field |

Cursor starts at `getTrackStartAnchor(id)` with heading `initialHeadingDeg` (default `0`).

`offset` (on `bucket`, `portal`, `gate`, `cylinder`, `resetBasin`, `cone`, `axisPull`, and `spinner` when set) is a **world-space** vector added to the
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

### C++ toys: `cone` and `axisPull`

Two more toys that used to exist only inside hand-written table feeders.

**`cone`** is a static solid cone, apex up along +Y, its base centred on
cursor + `offset` (the compiler lifts the collider centre by `halfHeight`). It
exports as ONE `cone` descriptor → `addStaticCone` (`native/src/Cone.cpp`), never
a triangle fan; the Rapier dev path builds `ColliderDesc.cone(halfHeight, radius)`.
Use it as a deflector mound that splits the ball's line. Keep the apex off the
spawn line for the same reason as lattice pins: a ball dropped dead-centre on
it balances in a deterministic solver.

**`axisPull`** is the Mag Spin well as data: a vertical cylinder of `radius`
and `halfHeight` about cursor + `offset` that pulls every ball inside it
horizontally toward the axis — `strength` m/s² at the axis, fading linearly to
nothing at the rim, mass-independent, never lifting. It exports as ONE
`axisPullField` descriptor → `addForceField({ mode: 'axis-pull' })`, i.e.
`addAxisPullField`. That binding takes no rotation, so `axis` must be
`{ x: 0, y: ±1, z: 0 }`; the validator refuses anything else, and the exporter
refuses a tilted descriptor. `strength` is capped at 60 m/s² like `forceField`.
`enabled: false` builds the well switched off (`setForceFieldEnabled`).
`visible` draws a faint, static translucent column — nothing flashes.

The well is **C++-only**: the Rapier dev path builds the track without it, and
does not build the Mag Spin feeder's Rapier-era bowl either (that bowl stays
inside `MagSpinFeeder`'s own degrade branch). Like a force field, a well must
never be the only way through a track. A bundle that predates the well returns
`-1`, which the exporter reports `unsupported` rather than dropping it silently.

`gap` accepts negative `length` and `drop`, which is the idiomatic way to nudge the
cursor backwards or upwards before a segment whose builder call has a fixed offset
of its own (see `CHRONO_CORE.json`, where a `-0.5 / -1` gap lines the second gear up
with the position its original TypeScript builder used).

## Element segments (#505 §A)

What the hand-written TS track modules built inline — seeded scatters, kinematic
movers, parts riding a spinner, pin lanes, decor — as data. They compile in
`src/adventure/track-elements.ts`, through `TrackBuilderApi` only.

### Placements (`at`)

`{ from?, mark?, frame?, offset?, along?, lateral?, normal?, up? }`. From an anchor
the compiler adds, in this order, each as one vector add: the world-space `offset`,
`along` the anchor's heading, `lateral` along its right, `normal` off the ramp
surface, then each `up` entry to y in turn. A placement therefore reproduces the
arithmetic of the builders it replaced (`start.add(fwd.scale(a)).add(right.scale(l))`,
then `y +=`), which is what keeps the converted tracks bit-identical.

| Anchor | Position | Heading |
|--------|----------|---------|
| `cursor` (default) | the cursor | the cursor's |
| `rampStart` | start of the most recent straight | that straight's |
| `rampCenter` | that straight's centre line at half its length | that straight's |
| `spinner` | centre of the most recent spinner | the one it was built at |
| `mark: "<name>"` | a `mark` | the mark's |

`frame: "surface"` (with `from: "rampStart"`) measures `along` down the ramp surface
and `normal` off it, instead of horizontally.

### Numbers

Movers, scatters and rotations take a **number spec**: a literal, `{ start, step }`
(element `i` gets `start + i × step`), or `{ random: [min, max], scale? }`
(`min + r × (max − min)`, times `scale`, `r` from the segment's seeded stream). A
`seedKey` names the stream, `getLayoutRng(seedKey)`: one stream per key for the
whole track, keyed by the session seed like every runtime collider layout.
Rotations are in **turns** (`{ random: [0, 1] }` is a full yaw).

### Shapes

Collider shapes: `box` (`size: { x, y, z }`, full extents), `cylinder` / `prism`
(`diameter`, `height`; a prism is one triangular convex hull), `sphere`
(`diameter`), `tetra` (debris: a cube collider of half-extent `size / 3`, a
tetrahedron mesh). Inside a `scatter`, a dimension may be `"size"`: the copy's
seeded size. An element's mesh matches its collider unless `mesh` is `false` or a
list of mesh shapes (the first rides the body, the rest are its children at
`local`). Mesh-only shapes add `torus`.

### Segments

| `type` | What it builds |
|--------|----------------|
| `mark` | Remembers the cursor (position and heading) as `name`. |
| `jump` | Moves the cursor: `to` a mark (its heading too), the `midpoint` of two marks, or `at` a placement; `headingOf` takes a mark's heading. |
| `scatter` | `count` copies of `shape` (or one of `shapes`) strewn by `seedKey`. Each copy draws, in this order: `along`, `lateral`, the shape (copy uses `shapes[k]`, k = how many of 1/n, 2/n, … the draw exceeds), `size`, the `rotation` axes x, y, z, then its motion numbers. Positions from `from` (default `rampStart`); `seat` lifts each copy by half its height (off the surface in a surface frame), `up` by fixed amounts. `materials` cycles cosmetic colours. |
| `obstacle` | Explicit `items` (each with its own `at`): static colliders, sensors, `zone`s and movers. The segment's fields are defaults an item overrides. `variants` (with `seedKey`) picks one item list by one draw. |
| `spinnerParts` | Colliders riding the most recent spinner: a `ring` (`count`, optional `gapDeg` opening and `segments` steps) or `points` (`angleDeg`, `radius`), at `radius` / `radiusFactor` and local height `y`. A box may be as deep as its ring step (`size.z: "arc"`, plus `arcPad`). `body: "own"` builds them as one co-rotating kinematic sensor body (`reset`: a reset sensor) instead of attaching them to the platform. |
| `pinRows` | Pachinko Hall's pin lanes on the most recent straight: row k at `k × spacing`, pins at `oddOffsets` / `evenOffsets`, none closer than `edgeMargin` to a side, `max(2, ⌊length / spacing⌋ − 1)` rows, one static cylinder each. The lift follows the heading-0 ramp normal, as the TS lane did. |
| `arcPylon` | A static post with a repulsive gravity well, at the cursor or `at`. |
| `decor` | Meshes only — no colliders. `parent: "spinner"` hangs them on the most recent spinner at `local`; a tube runs from `at` to `to`. |

Element fields (on `obstacle` and `scatter`, and on each obstacle item): `shape`,
`material`, `label`, `orient` (`heading`: yawed to the anchor heading; `ramp`: also
tilted with the most recent straight), `restitution`, `friction`, `collisionColor`
(chroma group `RED` / `GREEN` / `BLUE`), `local` (collider offset in its body),
`sensor`, `zone`, `motion`, `mesh`.

- `motion`: `{ kind: piston | oscillator | rotatingOscillator, frequency, amplitude,
  phase, axis ("right" or a vector), travel, draw, bindMesh }` — a
  `kinematic-position` body driven per frame (`AnimatedObstacle`). `travel: [top,
  bottom]` sets a piston's centre and amplitude from two y offsets. `draw` orders the
  seeded draws (default frequency, amplitude, phase). `bindMesh` also registers a
  kinematic binding.
- `zone`: `{ kind: "conveyor", force }` (world force), `{ kind: "rampConveyor", force }`
  (down the most recent straight's slope) or `{ kind: "damping", damping }`. A zone is
  a sensor owned by its zone list, with no mesh unless `mesh` asks for one.

Smaller additions: `straight.headingOffsetDeg` (build the ramp off the cursor
heading without turning the cursor), `curve.conveyor` (chord-by-chord conveyor
sensors along the curve: Tesla Tower's coil), `spinner.angVel` (rad/s, instead of
`angVelDeg`) and `spinner.at` / `bucket.at` placements, and `pbr:#rrggbb` materials
(the glassy PBR track material).

The validator also checks order across the track: `spinnerParts`, a spinner-parented
`decor` and any `from: "spinner"` placement need an earlier spinner; `rampStart` /
`rampCenter`, `pinRows`, a ramp conveyor and `orient: "ramp"` need an earlier
straight; every mark a segment names must be defined before it; a `{ random }`
value or `variants` needs a `seedKey`.

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
| `cone` | `fixed` | no | `addStaticCone` |
| `axisPullField` (vertical cylinder, no body) | `fixed` | no | `addForceField` (`mode: 'axis-pull'` → `addAxisPullField`) |

Rejected: `dynamic` bodies, a moving or sensor `convexMesh`, a moving, sensor
or attached `pinField` / `forceField` / `cone` / `axisPullField`, a tilted
`axisPullField`, attachments
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
| `cone` | one `cone` |
| `axisPull` | one `axisPullField` |
| `scatter`, `obstacle` | fixed or `kinematic-position` boxes / cylinders / spheres / prism hulls; sensor boxes / cylinders for zones |
| `spinnerParts` | boxes / cylinders attached to the platform, or one `kinematic-velocity` sensor body with attachments |
| `pinRows` | fixed cylinders |
| `arcPylon` | fixed cylinder + sphere sensor (gravity well) |
| `curve` with `conveyor` | the curve's boxes + sensor boxes |
| `portal`, `gap`, `turn`, `mark`, `jump`, `decor` | none (portal sensor is created on activation) |

`npm run tracks:validate` enforces the contract: it builds every JSON track
through the real `TrackBuilder.buildFromDefinition` path
(`tests/helpers/track-export-harness.ts`) and fails any track whose descriptor
list has an `unsupported` entry or an unexported Rapier collider.

## Runtime behavior

1. `switchToTrack` loads and parses the track (`loadDataTrackDefinition`: its JSON
   chunk and the schema, cached after the first load) **before** `clearTrack()`.
2. A missing or invalid track → `switchToTrack` returns `false`, prior geometry
   stays intact, HUD shows a soft error via `uiManager.showMessage`.
3. Valid data → tear down → `buildFromDefinition` → collision groups.

Every track is JSON (`buildKind: 'json'`); there are no TypeScript track builders.

## Shipped data tracks

**Campaign spine (JSON):** `NEON_HELIX`, `CYBER_CORE`, `QUANTUM_GRID`, `STORM_LATTICE`, `GLITCH_SPIRE`, `RETRO_WAVE_HILLS`, `HYPER_DRIFT`,
`CHRONO_CORE`, `SINGULARITY_WELL`, `CRYO_CHAMBER`, `FIREWALL_BREACH`. Optional branch: `PACHINKO_SPIRE`.

**Stage 5 (JSON, C++ toys only):** `STORM_LATTICE`. A 55° lattice board (one pin
field, 79 pins, a seeded dropout and a hole cleared for a mill) with two
ramp-anchored updraft shafts and two crosswinds that herd the ball toward the
goal basin. It is the reference for new schema content.

**Post-finale branch (JSON):** `TIDAL_NEXUS` → `SOLAR_FLARE` → `DIGITAL_ZEN_GARDEN`.

**Converted from TypeScript (#505 §A):** `PACHINKO_HALL`, `ORBITAL_JUNKYARD`, `CPU_CORE`,
`BIO_HAZARD_LAB`, `GRAVITY_FORGE`, `SYNTHWAVE_SURF`, `PRISM_PATHWAY`, `MAGNETIC_STORAGE`,
`NEURAL_NETWORK`, `NEON_STRONGHOLD`, `CASINO_HEIST`, `TESLA_TOWER`, `NEON_SKYLINE`,
`POLYCHROME_VOID` — built with the element segments above.

**Fixture (not catalogued):** `tests/fixtures/tracks/FUNNEL_WELL.json` — a 45°
pin lattice that empties onto a flat floor with a `cone` deflector and an
`axisPull` well before the goal basin. It is the reference for the two newer
toys. It is not under `src/adventure/track-data/`, has no manifest entry and is
not in the campaign rotation: a new pin-dense track waits for continuous
collision (#459 Slice B). Until it gets its own `AdventureTrackType` it borrows
`STORM_LATTICE`'s id, because the validator only admits catalogued ids.
`npm run tracks:validate` and `tests/track-cone-axis-pull.test.ts` build it.

`QUANTUM_GRID` and `CHRONO_CORE` were migrated from TypeScript in #321; the three spine
tracks above were migrated in the content-foundation slice with the same parity pattern.

A migration is only sound if the compiled JSON reproduces the original geometry.
`tests/track-json-migration-parity.test.ts` records the `TrackBuilder` call
sequence from a frozen copy of each original builder and from the compiled JSON,
then asserts the two are identical. Do a migration that way rather than by eye.

`tests/track-element-parity.test.ts` holds the 14 tracks converted in #505 §A to a
stricter bar: frozen copies of their builders (`tests/fixtures/ts-tracks/`) and the
JSON both build through the real `TrackBuilder` on two session seeds, and the
collider descriptor list (unrounded), body order, every per-track list and every
mesh pose must be identical — so the golden replay tapes (`CASINO_HEIST` has one)
cannot move. The one intended difference: Pachinko Hall's two conveyor sensors are
no longer also listed in `adventureBodies` (a zone sensor belongs to its zone list;
`clearTrack` used to remove them twice). Cosmetic only: Casino Heist's chip colours
cycle through the four chip materials instead of `Math.random()`.

> `QUANTUM_GRID`'s builder branched on `modeType`. Its catalog entry pins it to
> `EXTENDED_MAP`, so only that branch ever ran; the JSON captures it and the
> unreachable `STATIONARY_TABLE` variant is gone.

## Adding a data track

1. Author `src/adventure/track-data/MY_TRACK.json` with `id` matching an existing enum value.
2. Point the track's manifest at it: `buildKind: 'json'` + `dataPath: './track-data/MY_TRACK.json'`.
3. Run `npm run tracks:validate` and `npm test`.

## Validation

- Runtime: `validateTrackDefinition()` in `src/schemas/track.ts` — one Valibot schema; the segment / `TrackDefinition` types are inferred from it
- CLI: `npm run tracks:validate` (wraps `tests/tracks-validate-cli.test.ts`; covers `src/adventure/track-data/` and `tests/fixtures/tracks/`)
- CI / local: `tests/track-schema.test.ts`, `tests/track-element-schema.test.ts`, `tests/track-json-migration-parity.test.ts`, `tests/track-element-parity.test.ts`, `tests/track-footprint.test.ts`
