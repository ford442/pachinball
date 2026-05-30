# Free Map Test Mode

## Overview

The Free Map Test Mode is a developer sandbox that allows instant switching between any adventure track layout without following the normal campaign progression. It's designed for rapid iteration on physics, visuals, and track design.

## Activation

### Keyboard Shortcut
Press **Ctrl+Shift+M** to toggle Free Map Test Mode on/off.

### Programmatic Access
```typescript
// From browser console (when game instance is accessible):
game.toggleFreeMapTestMode()

// Or directly:
game.freeMapTestMode?.activate()
game.freeMapTestMode?.deactivate()

// Load a specific track:
game.freeMapTestMode?.loadById('CYBER_CORE')
```

## Controls (while Test Mode is active)

| Key | Action |
|-----|--------|
| **Ctrl+Shift+M** | Toggle test mode on/off |
| **PageDown** | Cycle to next track |
| **PageUp** | Cycle to previous track |
| **Drain** | Auto-advance to the next track and respawn launch-ready |

Standard gameplay controls (flippers, plunger, nudge) remain active during test mode.

## HUD Indicator

When test mode is active, a green HUD overlay appears in the top-right corner showing:
- Current track name
- Layout type (extended / stationary)
- Position in registry (e.g., "3/25")

## Available Layouts

All 25 adventure tracks are available in test mode:

### Extended Maps (scrolling 3D landscape)
- Neon Helix, Quantum Grid, Singularity Well, Glitch Spire, Retro Wave Hills, Chrono Core, Hyper Drift, Orbital Junkyard, Firewall Breach, CPU Core, Cryo Chamber, Bio Hazard Lab, Gravity Forge, Tidal Nexus, Digital Zen Garden, Synthwave Surf, Solar Flare, Prism Pathway, Magnetic Storage, Neural Network, Neon Stronghold, Casino Heist, Tesla Tower, Neon Skyline, Polychrome Void

### Stationary Tables (classic pinball arena)
- Cyber Core, Pachinko Spire

## Architecture

The test mode is built on three modules:

1. **`src/game/map-registry.ts`** — Unified layout registry that combines adventure track metadata with the `TRACK_CATALOG` into a flat list of `MapConfig` entries.

2. **`src/game/level-loader.ts`** — `LevelLoader` class that handles:
   - Looking up map configs
   - Ensuring adventure mode is active
   - Delegating to `AdventureMode.switchToTrack()` (which internally calls `clearTrack()` to dispose physics bodies/meshes)
   - Resetting the ball to plunger position

3. **`src/game/free-map-test-mode.ts`** — `FreeMapTestMode` class that provides:
   - Activation/deactivation lifecycle
   - Keyboard shortcut registration (PageUp/PageDown) plus drain-to-advance flow
   - HUD indicator management
   - Registry cycling logic

## Physics Cleanup

Each track switch calls `AdventureMode.clearTrack()` which:
- Disposes all track meshes and materials
- Removes all rigid bodies from the Rapier physics world (checking `getRigidBody(handle)` before removal)
- Clears conveyor zones, gravity wells, damping zones, sensors, and chroma gates
- This prevents body leaks and double-collider bugs during repeated switches

## Notes

- Test mode bypasses campaign unlock gates — all tracks are available immediately.
- The existing adventure campaign flow is not affected; test mode operates independently.
- The `GameInputManager` registers Ctrl+Shift+M as a global shortcut (works in any game state).
