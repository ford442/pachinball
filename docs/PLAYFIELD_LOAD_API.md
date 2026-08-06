# Playfield Load / Teardown API

Single authority for in-session adventure layout switches. All campaign portal
jumps, free-map test loads, and dev track cycling MUST go through
`loadPlayfield()` in `src/game/playfield-loader.ts`.

Initial table boot (`GameSceneBuilder.buildGameplayScene`) and table-return
(`GameSlotAdventure.endAdventureMode`) are separate entry points — they do not
call `loadPlayfield()`.

---

## Entry-point sequence diagram

```mermaid
sequenceDiagram
    participant User
    participant Boot as GameSceneBuilder
    participant Table as Table playfield
    participant Portal as AdventureProgressionSupervisor
    participant Slot as GameSlotAdventure
    participant Loader as loadPlayfield()
    participant Adv as AdventureMode
    participant Phys as PhysicsController
    participant Free as FreeMapTestMode

    Note over User,Boot: 1. Initial table boot (one-time)
    User->>Boot: Start Game
    Boot->>Table: buildGameplayScene()
    Boot->>Phys: rebuildHandleCaches()

    Note over User,Free: 2. First adventure entry (no prior track teardown)
    User->>Slot: startAdventureMode()
    Slot->>Table: setTableBodiesEnabled(false)
    Slot->>Adv: start(track) → buildTrack()
    Slot->>Phys: rebuildHandleCaches()

    Note over User,Phys: 3. Campaign portal → next track (canonical path)
    User->>Portal: ball enters exit portal
    Portal->>Slot: onTrackAdvanced(nextTrackId)
    Slot->>Loader: loadPlayfield({ source: campaign-portal })
    Loader->>Adv: switchToTrack()
    Adv->>Adv: deactivateExitPortal() → PORTAL_DEACTIVATED
    Adv->>Adv: clearTrack() → record TrackTeardownStats
    Adv->>Adv: buildTrack()
    Loader->>Phys: rebuildHandleCaches()

    Note over User,Free: 4. Free-map test mode
    User->>Free: PageDown / drain / loadById
    Free->>Loader: loadPlayfield({ source: free-map })
    Loader->>Adv: switchToTrack() (same teardown contract)
    Loader->>Phys: rebuildHandleCaches()
    Loader->>Loader: resetBall() (plunger)

    Note over User,Table: 5. Return to table
    User->>Slot: endAdventureMode()
    Slot->>Adv: end() → clearTrack()
    Slot->>Table: setTableBodiesEnabled(true)
    Slot->>Phys: rebuildHandleCaches()
```

---

## API

### `loadPlayfield(spec, deps)`

```typescript
import { loadPlayfield, type PlayfieldSpec } from './playfield-loader'

const result = loadPlayfield(
  { trackId: 'CYBER_CORE', source: 'campaign-portal' },
  deps,
)

if (result.success) {
  console.log(result.teardown) // TrackTeardownStats from prior layout
}
```

| Field | Type | Description |
|-------|------|-------------|
| `trackId` | `string` | Adventure track id (`AdventureTrackType` value) |
| `source` | `PlayfieldLoadSource` | `campaign-portal` \| `free-map` \| `dev-cycle` \| `table-return` |
| `resetBallToPlunger` | `boolean?` | Default `true` for free-map, `false` for campaign |
| `syncGameMode` | `boolean?` | Default `true` for campaign (A/B `fixed`/`dynamic`) |
| `syncTableMap` | `boolean?` | Default `true` for campaign (LCD shader map) |

### `LevelLoader` (facade)

`LevelLoader` delegates to `loadPlayfield()`:

| Method | Maps to |
|--------|---------|
| `loadCampaignTrack(id)` | `loadPlayfield({ source: 'campaign-portal' })` |
| `loadMap(id)` | `loadPlayfield({ source: 'free-map' })` |
| `loadAdventureTrack(type)` | `loadPlayfield({ source: 'free-map', sync*: false })` |

---

## Teardown contract

`AdventureMode.switchToTrack()` always runs teardown before build:

| Step | Owner | Resources removed |
|------|-------|-------------------|
| 1 | `deactivateExitPortal()` | Exit portal mesh, portal Rapier sensor; emits `PORTAL_DEACTIVATED` → `unregisterPortalSensor()` |
| 2 | `clearTrack()` | Adventure meshes/materials, rigid bodies, conveyor/gravity/damping zones, reset sensors, chroma gates, adventure sensor |
| 3 | `rebuildHandleCaches()` | Refreshes collision-dispatch handle maps (caller, via `loadPlayfield`) |

Instrumentation: `AdventureMode.getLastTeardownStats()` returns `TrackTeardownStats`
after every `clearTrack()`. Counters are defined in
`src/game-elements/track-teardown-stats.ts` (`PLAYFIELD_TEARDOWN_FIELDS`).

**Acceptance:** `lingeringBodies === 0` after every load. A double-load must not
accumulate Rapier bodies — teardown removes all adventure-owned handles before
`buildTrack()` registers new ones.

---

## Callers (do / don't)

| Caller | Path | Correct? |
|--------|------|----------|
| `GameSlotAdventure.switchToTrack` | `LevelLoader.loadCampaignTrack` → `loadPlayfield` | ✅ |
| `FreeMapTestMode.loadCurrentMap` | `LevelLoader.loadMap` → `loadPlayfield` | ✅ |
| `AdventureProgressionSupervisor.onPortalEntered` | → `slotAdventure.switchToTrack` | ✅ |
| `GameSlotAdventure.startAdventureMode` | `adventureMode.start()` (first entry, no teardown) | ✅ (by design) |
| Direct `adventureMode.switchToTrack()` | Bypasses mode/map sync + cache rebuild | ❌ |
