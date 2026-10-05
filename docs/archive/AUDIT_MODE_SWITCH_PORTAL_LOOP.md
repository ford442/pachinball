# AUDIT REPORT: Mode Switching & Portal Loop in A/B Campaign

## pachinball (ford442/pachinball) — Comprehensive Gap Analysis

---

## EXECUTIVE SUMMARY

The A/B campaign portal loop has **3 Critical** and **5 Warning** gaps that collectively prevent bidirectional table↔adventure gameplay from working correctly. The supervisor→portal→track advancement chain is wired correctly at the EventBus level, but critical omissions in physics isolation, zone state cleanup, and A/B mode execution cause the loop to break in practice.

---

## GAPS FOUND

### 🔴 CRITICAL

| # | Gap | File | Line Area |
|---|-----|------|-----------|
| C1 | **Table physics bodies NOT disabled during adventure** — Ball collides with invisible table bumpers/flippers/walls | `src/game/game-slot-adventure.ts` | `startAdventureMode()` L145-147 |
| C2 | **`end()` does not reset `currentZone`/`previousZone`** — Stale zone state poisons next adventure start | `src/adventure/adventure-mode.ts` | `end()` L510-530 |
| C3 | **Ball velocity not zeroed on portal teleport** — Residual velocity carries into next track, can spawn ball inside walls | `src/adventure/adventure-mode.ts` | `updateExitPortal()` L395-405 |

### 🟡 WARNING

| # | Gap | File | Line Area |
|---|-----|------|-----------|
| W1 | **`activateExitPortal()` return value ignored** — UI shows "PORTAL OPEN" even if activation silently fails | `src/game/game-systems-init.ts` | `portal:open` handler L280-310 |
| W2 | **A/B alternation is cosmetic only** — `modeType` only affects portal visual size, not gameplay | `src/game/game-systems-init.ts` | `portal:open` handler + `src/adventure/adventure-mode.ts` |
| W3 | **Table mesh disable uses `setEnabled(false)` only** — Physics bodies remain in world; no collision filtering for adventure | `src/game/game-slot-adventure.ts` | `startAdventureMode()` L145 |
| W4 | **`switchToTrack()` doesn't reset ball physics state** — No velocity/position reset on track switch via supervisor callback | `src/adventure/adventure-mode.ts` | `switchToTrack()` L470-510 |
| W5 | **`getNextAdventureTrack()` wraps infinitely** — Campaign completion has no end-state; loops forever | `src/adventure/portal-routing.ts` | `getNextAdventureTrack()` L78-82 |

### 🟢 INFO

| # | Observation | File |
|---|-------------|------|
| I1 | `game.gameMode` is always `'fixed'` — never synced to track's `modeType` | `src/game.ts` L180 |
| I2 | `PORTAL_ENTERED` event timing is safe — no race condition on sensor handle | `src/adventure/adventure-mode.ts` |
| I3 | ZONE_ENTER is emitted from `switchToTrack()`, not lost — event arrives via correct path | `src/adventure/adventure-mode.ts` |
| I4 | Supervisor `reset()` before `advanceToNextTrack()` is intentional and safe | `src/game-elements/adventure-progression-supervisor.ts` |

---

## EVENT FLOW ANALYSIS

### Intended Flow (from ADVENTURE_CAMPAIGN.md)

```
[Supervisor.update] → score≥goal? → emit "portal:open" (success)
                                    → activateExitPortal() → registerPortalSensor()
                                    → UI shows portal overlay
                                    → [per-frame] updateExitPortal() detects ball
                                    → emit "PORTAL_ENTERED" (internal callback)
                                    → handler calls supervisor.onPortalEntered()
                                    → supervisor emits "portal:entered" + "track:completed"
                                    → supervisor.reset() + advanceToNextTrack()
                                    → onTrackAdvanced → slotAdventure.switchToTrack()
                                    → adventureMode.switchToTrack() → clearTrack() + buildTrack()
                                    → ZONE_ENTER emitted from switchToTrack()
```

### Actual Flow (gaps highlighted)

```
[Supervisor.update] → score≥goal? → emit "portal:open" (success, mode=modeType)
                                    → handler: activateExitPortal(resolvedTrack, kind, resolvedMode)
                                    ⚠️ W1: Return value NOT checked — may return false silently
                                    → registerPortalSensor(handle) — handle may be -1
                                    → UI shows "PORTAL OPEN" (always)
                                    → [per-frame] updateExitPortal() detects ball
                                    → zero velocity? ⚠️ C3: Only position set, velocity may drift
                                    → emit "PORTAL_ENTERED" → handler:
                                       → supervisor.onPortalEntered()
                                       → emits "portal:entered" + "track:completed"
                                       → reset() + advanceToNextTrack()
                                       → onTrackAdvanced → slotAdventure.switchToTrack()
                                       → adventureMode.switchToTrack()
                                          → clearTrack() + buildTrack()
                                          → ZONE_ENTER emitted ✓
                                          → ⚠️ W4: No ball physics reset
                                          → ⚠️ C1: Table physics still active (invisible)
                                    → deactivateExitPortal() (redundant after clearTrack)
                                    → switchZone(nextTrack) — early-returns because
                                      switchToTrack() already set currentZone
                                    → ZONE_ENTER would be lost, BUT already emitted ✓

[END event flow]:
    toggleAdventure() → slotAdventure.endAdventureMode()
    → adventureMode.end()
    → ⚠️ C2: currentZone/previousZone NOT reset (stay at last track values)
    → next startAdventureMode():
       → previousZone = currentZone (stale last track) — wrong transition detection
       → isMajorZoneTransition() may return incorrect result
```

---

## PER-GAP DETAIL

### 🔴 C1: Table Physics Bodies NOT Disabled During Adventure

**File:** `src/game/game-slot-adventure.ts:145-147`
**Code:**
```typescript
const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
pinballMeshes.forEach(m => m.setEnabled(false))
```

**What's Missing:** Only the **visual meshes** are disabled. The Rapier physics bodies (bumpers, flippers, walls, targets) remain fully active in the physics world. The ball collides with invisible table objects during every adventure track.

**Impact:**
- In EXTENDED_MAP tracks: Ball bounces off invisible walls/bumpers — completely breaks the scrolling landscape experience
- In STATIONARY_TABLE tracks: Might be partially intended, but table features shouldn't interfere with track-specific elements

**What Should Happen:**
```typescript
// In startAdventureMode() — disable BOTH visuals AND physics
const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
pinballMeshes.forEach(m => m.setEnabled(false))

// ALSO: Disable table physics bodies
this.host.gameObjects?.getBumperBodies().forEach(b => b.setEnabled(false))
this.host.gameObjects?.getTargetBodies().forEach(b => b.setEnabled(false))
const flippers = this.host.gameObjects?.getAllFlippers()
if (flippers) {
  for (const f of flippers.values()) f.body.setEnabled(false)
}
// Store "table physics disabled" flag; re-enable in endAdventureMode()
```

Or alternatively, use collision group filtering to exclude the ball from table collisions during adventure mode.

---

### 🔴 C2: `end()` Does Not Reset `currentZone`/`previousZone`

**File:** `src/adventure/adventure-mode.ts:510-530`
**Code:**
```typescript
end(): void {
  if (!this.adventureActive) return
  this.adventureActive = false
  this.deactivateExitPortal()
  if (this.onEvent) this.onEvent('END')
  // Restore Table Camera...
  this.currentBallMesh = null
  this.currentCameraPreset = null
  this.clearTrack()
  // ❌ currentZone and previousZone NOT reset
}
```

**What's Missing:** `currentZone` and `previousZone` retain their last values from the completed adventure session.

**Impact:** When `start()` is called next:
```typescript
start(...) {
  this.previousZone = this.currentZone  // ← stale value from last session!
  this.currentZone = trackType
  // ZONE_ENTER emitted with wrong previousZone
}
```

The zone transition effects (isMajor calculation) use the stale `previousZone` from the last session, producing incorrect transition intensity and wrong story narration.

**What Should Happen:**
```typescript
end(): void {
  // ... existing cleanup ...
  this.clearTrack()
  this.currentZone = null      // ← ADD
  this.previousZone = null     // ← ADD
}
```

---

### 🔴 C3: Ball Velocity Not Zeroed on Portal Teleport

**File:** `src/adventure/adventure-mode.ts:395-405`
**Code:**
```typescript
for (const [index, ballBody] of ballBodies.entries()) {
  const lateralOffset = index * 0.35
  ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
  ballBody.setTranslation({
    x: teleportPos.x + lateralOffset,
    y: teleportPos.y,
    z: teleportPos.z,
  }, true)
}
```

**Analysis:** Velocity IS zeroed here. BUT — the issue is with `switchToTrack()` which is called asynchronously via the callback chain.

The real issue: If `buildTrack()` in `switchToTrack()` places geometry at the ball's current position, the ball can end up inside a newly-created wall.

**What Should Happen:**
Add ball reset in `switchToTrack()` after `buildTrack()`.

---

## FIX RECOMMENDATIONS

### Priority 1: Critical Fixes

**Fix C1 — Disable table physics during adventure:** (see code in issue body)

**Fix C2 — Reset zone state in `end()`:** (see code above)

**Fix C3 — Reset ball in `switchToTrack()`:** (see code in full report)

---

*Report generated from source analysis of ford442/pachinball repository.*