# Collider Lifecycle Audit Report — A/B Campaign Loop

## Repository: ford442/pachinball — Rapier3D WASM + Babylon.js Hybrid

## Executive Summary

The A/B campaign loop has **5 critical gaps** that cause stale physics handles, phantom collisions, and missing cache invalidation during mode transitions. The most severe issue is that table physics bodies remain fully active in the world during adventure mode.

## Gaps Found

### 🔴 G1: Table Physics Bodies Stay Active During Adventure Mode (INVISIBLE COLLISIONS)
**Severity**: Critical

When entering adventure mode, `startAdventureMode()` only disables the *visual* meshes. All Rapier physics bodies remain active. Adventure track bodies use default collision groups.

**Fix**: Disable table bodies + apply `ADVENTURE_GROUP` collision groups in track-builder.ts.

### 🔴 G2: Stale Portal Sensor Handle in `portalSensorHandleSet`
`deactivateExitPortal()` removes body but never unregisters handle. Stale handles cause `processCollision()` to early-exit.

**Fix**: Emit `PORTAL_DEACTIVATED` event from `deactivateExitPortal()`.

### 🔴 G3: `rebuildHandleCaches()` Never Called After Adventure Transitions
Never called in `endAdventureMode()` or `switchToTrack()`.

**Fix**: Call it after every mode/track transition.

### 🟡 G4: `adventureSensorHandle` Not Updated After `rebuildHandleCaches()`
`rebuildHandleCaches()` sets it to -1 without re-querying active adventure sensor.

### 🟡 G5: `createRotatingPlatform` Tooth Meshes Not Tracked
Tooth meshes not pushed to `adventureTrack[]`.

### 🔴 G7: `clearTrack()` getRigidBody Guard Is Fragile
Handle recycling risk.

### 🔴 G8: Adventure Track Colliders Use Default Collision Groups
No separation from table bodies.

## Priority Order
P0: G1 + G8 (table physics isolation + collision groups)
P1: G2, G3, G7

---
*Audit conducted on commit with docs/PHYSICS_COLLISION_AUDIT.md Issue #171 notes incorporated.*