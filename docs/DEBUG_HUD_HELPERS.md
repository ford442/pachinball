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
Add to DebugHUD: adventureActive, currentZone, portalSensorHandle, portalHandleSetSize, tablePhysicsEnabled, activeCameraType.

## 3. Automated Assertions (Playwright)
See full content in swarm output for E2E test examples.

## 4. EventBus Logger
Temporary logger for portal:open, PORTAL_ENTERED, track:completed, etc.

*For development only.*