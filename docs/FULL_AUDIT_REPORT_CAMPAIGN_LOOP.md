# Pachinball A/B Campaign Loop — Full Audit Report

## Integrated findings from Physics, Mode/Portal, and Camera/Input auditors

**Verdict:** The portal event flow is architecturally correct. The gaps are in the "glue": physics isolation, input gating, camera lifecycle, and cache invalidation.

## Cross-Auditor Convergence

| Gap | Physics | Mode | Camera | Severity |
|-----|---------|------|--------|----------|
| Table physics active during adventure | G1 | C1 | W3 | 🔴 P0 |
| No collision group separation | G8 | — | — | 🔴 P0 |
| Camera type mismatch | — | — | G1 | 🔴 P0 |
| No input filtering in adventure | — | — | G2 | 🔴 P0 |
| Camera follow toggle overrides adventure | — | — | G7 | 🔴 P0 |

## Recommended Fix Order (Waves)
**Wave 1 (Isolation)**: Disable table physics + input filter + follow toggle guard
**Wave 2 (Camera)**: Base Camera type + detachControl + zone reset
**Wave 3 (Portal Robustness)**: PORTAL_DEACTIVATED event + rebuildHandleCaches calls
**Wave 4 (Polish)**: Ball reset in switchToTrack + A/B differentiation

---
*Full integrated report 2026-06-01*