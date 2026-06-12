# Debug HUD & Console Helpers — Pachinball Campaign Loop

Lightweight debugging tools for validating the A/B campaign loop.

## 1. Console Helpers (devtools)

```javascript
// Campaign state
console.log("Adventure active:", game.adventureMode?.isActive())
console.log("Current zone:", game.adventureMode?.getCurrentZone())
console.log("Portal sensor handle:", game.adventureMode?.getPortalSensorHandle())
console.log("Portal handle set size:", game.physicsController?.portalSensorHandleSet?.size)

// Quick validation
console.log("Table bodies disabled:", game.gameObjects?.getBumperBodies?.().every(b => !b.isEnabled?.()))
```

## 2. Debug HUD Panel Additions

The HUD (press `` ` `` to toggle, gated by `import.meta.env.DEV` or `?debug=1`)
shows a "Campaign" panel with:

- `adventure active` — `adventureMode?.isActive()`
- `portal sensor handle` — `adventureMode?.getPortalSensorHandle()` (`-1` when no portal is open)
- `portal handle set size` — `physicsController.getPortalSensorHandleSetSize()`
- `table physics enabled` — `gameObjects.areTableBodiesEnabled()`
- `active camera` — `scene.activeCamera?.getClassName()` (e.g. `FreeCamera`, `ArcRotateCamera`)

Values update at the existing 250ms HUD cadence.

## 3. Automated Assertions (Playwright)
See full content in swarm output for E2E test examples.

## 4. EventBus Logger
Temporary logger for portal:open, PORTAL_ENTERED, track:completed, etc.

*For development only.*