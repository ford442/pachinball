# Static scene (render hygiene, #443)

Most of the scene is static while a game runs, so the renderer stops re-deriving it every frame: a few materials are
frozen, Babylon's active-mesh list is frozen, the colour clear is skipped under the skybox, and the pin fields are one
thin-instance mesh each. All of it hangs off one object, `StaticSceneGate`. Numbers are in
[`RENDER_BUDGET.md`](./RENDER_BUDGET.md).

## The gate (`src/core/static-scene-gate.ts`)

`game.staticSceneGate` is `null` until `src/game/static-scene-install.ts` (its own chunk, loaded during init) has run; every
caller uses `game.staticSceneGate?.…`, so an invalidation before that is simply not recorded (nothing is frozen yet either).

| call | use it when |
|---|---|
| `invalidate(reason, { materials, shadows })` | something that frozen state ignores just changed. Coalesced; the targets refreeze after `FRAMES_BEFORE_REFREEZE` quiet frames |
| `hold(reason, opts)` → `release()` | a change spans async work (cabinet glTF load, track build). Frozen state stays thawed until released |
| `watchState(reason, read)` | a value changes continuously and cannot be called out (fog easing, the render-state signature): the gate samples `read()` every frame and invalidates when it differs |
| `registerTarget(target)` | something freezable: `thaw(invalidation)`, `refreeze()`, `canRefreeze()` |

A thrash guard (`THRASH_MAX_REFREEZES` in `THRASH_WINDOW_MS`) backs off when a scene never settles. `getStats()` and the
`?debug=1` HUD show the state, `refreezeCount` and the last reasons.

Already wired: ball spawn / collect (`BallManager`), cabinet preset load (`hold`), track build / clear (`AdventureMode`),
`applyQualityTier` and the automatic tier drop, scene fog, meshes added / removed, and the fever / jackpot / multiball event
windows (existing `EventBus` events, no new ones). **If you add code that mutates a frozen material, adds a light or a shadow
caster, or toggles meshes in bulk, call `invalidate` (or `hold` around async work).**

## What is frozen

- **Materials** (`FrozenMaterialSet`, `src/game/frozen-material-set.ts`): an explicit allowlist, one `add(material, why)` per
  material with the reason it is safe. Today only unlit room decor (`disableLighting`, never written after creation). Never add a
  material that the quality sync or an effect animates, a ball material, or one with `FresnelRimMaterialPlugin`. On WebGL2 the
  light-budget clamp runs over the set before every freeze, because a frozen material never recompiles to pick it up.
- **Active meshes** (`FrozenActiveMeshes`, `src/game/frozen-active-meshes.ts`): the list is captured unclipped (it must not
  depend on where the camera aims) and thawed by `RenderStateWatcher` when a mesh is enabled / disabled / re-materialled, a
  material changes render group, a particle system starts or stops, `scene.particlesEnabled` flips, or the camera moves or is
  replaced. Off with `?freezeMeshes=0`. Not `scene.freezeActiveMeshes()`: that waits for every particle system and texture to be
  ready, which never happens once the ball trail starts.
- **Colour clear** (`SkyboxAutoClear`, `src/game/skybox-auto-clear.ts`): `scene.autoClear = false` only while the camera is inside
  the skybox and the skybox is enabled and visible; never on mobile (tile GPUs get slower).

## Pins (`src/objects/pin-lattice.ts`)

A lattice is one mesh with a static `thinInstanceSetBuffer('matrix', …)` built from `resolvePinField(spec)`, the resolver that
also places the colliders. One rotation per lattice; the buffer is static, so a lattice that changes is rebuilt, not patched
(`thinInstanceSetMatrixAt` is a no-op on a static buffer). Colliders are unchanged: one `PhysicsBinding` per lattice, toggled
with the table on both the wasm-owner and Rapier paths.

## Measuring

Use `?noopt=1`: the game's `SceneOptimizer` degrades a slow device (software GL, any device under 55 fps) by switching shadows,
particles, post-processes and render targets off, which would hide everything above. The perf harness does.
