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
| `spinner` | `radius`, `angVelDeg`, optional `teeth`, `advance`, `material` | `createRotatingPlatform` |
| `gate` | `color`: `RED` \| `GREEN` \| `BLUE` | `createChromaGate` |

Cursor starts at `getTrackStartAnchor(id)` with heading `0`.

## Runtime behavior

1. If `id` has a JSON definition, `validateTrackDefinition` runs **before**
   `clearTrack()`.
2. Invalid data → `switchToTrack` returns `false`, prior geometry stays intact,
   HUD shows a soft error via `uiManager.showMessage`.
3. Valid data → tear down → `buildFromDefinition` → collision groups.

Hand-tuned flagships (`NEON_HELIX`, `PACHINKO_HALL`, `CYBER_CORE`) remain TypeScript builders.

## Adding a fourth data track

1. Author `src/adventure/track-data/MY_TRACK.json` with `id` matching an existing enum value.
2. Remove that track’s `buildX` from the `AdventureMode.buildTrack` switch and barrel exports (if present).
3. Run `npm test` — Vitest validates every shipped JSON file.

## Validation

- Runtime: `validateTrackDefinition()` in `src/adventure/track-schema.ts`
- CI / local: `tests/track-schema.test.ts`
