# Camera + Input Remapping Audit Report — Pachinball

## Executive Summary

**10 distinct gaps** found. Most severe: fundamental camera type mismatch (FreeCamera vs expected ArcRotateCamera), absence of adventure-specific input filtering, and camera follow toggle overriding adventure mode.

## Critical Gaps

### G1: Camera type mismatch (FreeCamera cast to ArcRotateCamera)
`GameRenderer` creates `FreeCamera`. `AdventureMode.start()` expects `ArcRotateCamera`. Dangerous casts in multiple places. Cinematic system `.alpha/.beta/.radius` silently fail.

**Fix**: Use base `Camera` type. Wire cinematic system to `followCamera`.

### G2: No input mode filtering
Flipper/plunger inputs fire in adventure mode because `InputHandler` only checks `GameState.PLAYING`.

**Fix**: Add `adventureMode?.isActive()` guard in `stepPhysics()` and input handler.

### G7: Camera follow toggle (`C` key) overrides adventure
`isCameraFollowMode` forces `BALL_FOLLOW` even during adventure.

**Fix**: Condition the toggle on `!adventureMode?.isActive()`.

## Other Gaps
G3: Missing `detachControl()` before dispose
G4: Space bar nudge in both modes (unintended air control in adventure)
G5: Inputs not blocked during 0.8s camera transition
G8: Ball mesh `lockedTarget` becomes stale
G9: Camera shake applied to inactive table camera

## Recommended Fix Order
P0: G1, G2, G7
P1: G3, G5, G8

---
*Report from parallel camera/input auditor.*