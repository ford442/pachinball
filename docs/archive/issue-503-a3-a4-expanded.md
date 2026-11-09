# #503 A3 + A4 — one throw must not freeze the game, and a finished run must not land twice

> Expanded 2026-11-05 from the §B draft in `docs/archive/dispatch-2026-11-05.md`, using answers from Gemini Pro, gpt-oss-120b and Grok. Every file/line reference was re-checked against `origin/main` **`5e84717`** (after #509). **Gemini was given a stale tree** (before #488 / #471). It reported no `src/core/frame-scheduler.ts`, no `supabase/`, no `services/replay-verifier/`, and `apiFetch` posting scores to `api/replays.py`. All of that is wrong for `main`. Its Babylon render-loop analysis, the `Headers`-instance finding, the Rapier-path gap and the "don't infer verification from `isPlaying()`" point still hold, and they are kept below. Grok's ecosystem claims (Babylon 9.x notes, the Idempotency-Key draft revision) are cited as Grok's and were not independently checked.

## Context

Part of #503 (P0 production hardening). On current `main`:

1. **No fault isolation in the frame.** `FrameScheduler.tick` (`src/core/frame-scheduler.ts:160-180`) calls `entry.system.update(dt)` bare. Babylon's `_renderLoop` only requeues after `_processFrame` returns, and its `_renderFrame` calls render functions without try/catch (per Gemini, from `abstractEngine.pure.js`; Grok confirms nothing changed in 9.x). So **one throw in any system ends rendering for good**. Production strips `console.*`, so nobody sees it.
   Registered systems today (`src/game.ts:331-351`, `src/game/render-resolution.ts:90`):

   | Phase | System |
   |---|---|
   | input | `latency-display` |
   | physics | `fixed-step` |
   | sim | `table`, `adventure` |
   | visuals | `table-visuals`, `cabinet` |
   | render | `scene` (→ `scene.render()`) |
   | hud | `hud` |
   | idle | `dynamic-resolution` |

   `onBeforeRenderObservable` callbacks run inside the `scene` system, so they share its fault domain.
2. **`EventBus.emit` (`src/core/event-bus.ts:477-502`) calls handlers bare.** It iterates a cached `snapshot` array, rebuilt only when the handler set changes. That is the #488 §5 zero-allocation design and it must survive this change. The per-step contact batch `'wasm:physics:contacts'` (emitted from `src/wasm/PhysicsModule.ts:~678` and the worker client) has one subscriber, `physics-controller.ts:142`. That subscriber loops over the contacts and dispatches each one, so a throw on contact *i* drops contacts *i+1…n* for that step, and also kills the frame.
3. **The Rapier path bypasses the bus.** `PhysicsSystem.stepRapier` drains collision events with a callback (`src/game-elements/physics.ts:407`). Wrapping `emit` alone leaves it unprotected.
4. **Duplicate submissions are real, but they don't come from where #503 says.** Scores, replays and challenges no longer go through `apiFetch`. They go through `src/arcade/arcade-api.ts`:
   - `send()` (`:94-130`) doesn't retry. But **any** fetch failure, including `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` firing after the server already committed, becomes `ArcadeError(…, 0, offline=true)`.
   - `submitRun` (`:256-266`) then **queues** the run.
   - `flushQueuedRuns` (`:281-300`) re-sends it later. **Result: a slow-but-successful `submit-score` lands twice.**
   - `sendRun` (`:238-243`) puts the new `replay_id` on a *copy* of `run.score`. If `submit-replay` succeeds and `submit-score` then times out, the flush **uploads the replay again**.
   - Neither `public.scores` nor `public.replays` (`supabase/migrations/20261016024958_arcade_core.sql:42,131`) has a uniqueness constraint that would catch either case.
5. **`apiFetch` (`src/config/api.ts:~68-123`)** has two remaining callers: `MapSystem` (GET) and `AdventureState` (GET + POST `/adventure/progress`). The header bug is real: `...options` after the merged `headers` replaces them; a `Headers` instance passes straight through; `signal` is applied last, so the timeout survives. Its 3× retry on 5xx/network covers POST too. The progress POST overwrites the saved progress (`put`-style), so a retry there is harmless but wrong in principle.

## Decisions (answers to the draft's open questions)

1. **Quarantine policy per phase**. gpt-oss's point stands: a "K consecutive" count never trips on a system that throws every other frame.
   - **`visuals` / `render` / `hud` / `idle` / `input`:** quarantine after **3 throws within the last 8 frames**, a sliding window held as a bitmask on the entry (no allocation).
   - **`physics` / `sim`:** never quarantined silently. **The first throw ends the run's ranked status.** In a verification or ranked-replay playback it **rejects the playback at once** (`ReplayRunner.reject`, which already exists at `src/replay/replay-runner.ts:58`). In live play, the system stays registered and the run is marked unranked. If it throws 3 times in 8 frames, the game goes to the existing GAME_OVER path instead of continuing on a divergent world.
   - No snapshot/rollback: a mid-step C++ rollback per frame is out of scope. #504 owns the world.
2. **Idempotency: do it, client and server, scoped to `arcade-api`.**
   - `QueuedRun` gains `submissionId` (one `crypto.randomUUID()` per finished run, persisted in the queue), and `sendRun` writes `replay_id` back onto the **queued** run once the replay uploads.
   - `submit-replay` and `submit-score` take an `Idempotency-Key` header. A new `public.submission_keys (profile_id, key, kind, response jsonb, created_at)` table with a `unique (profile_id, key, kind)` constraint, RLS service-role only, holds the stored response. Claim with `insert … on conflict do nothing`; on conflict return the stored response.
   - Grok: there's still no native Supabase/PostgREST idempotency, and supabase-js itself retries only GET/HEAD. So this is the standard pattern, not a reinvention.
   - `apiFetch`: header fix, plus **never retry non-idempotent methods** (anything other than GET/HEAD/PUT/DELETE). No key there; its only POST overwrites anyway.
3. **No toast for quarantine.** An unranked run shows the existing "not ranked" path at game over, if one exists. Otherwise `uiManager.showMessage` once, at game over, not in the frame path, to stay off the entry-chunk budget.
4. **Verifier:** `services/replay-verifier` already rejects on score/hash mismatch (`judge.mjs:48-91`). It also needs to reject when the playback's runner reports a sim-phase fault, so a fault that happens to reproduce the same score still can't verify. The flag is opt-in on the runner (`setStrict(true)`). Spectate, ghosts and tests leave it off. **Don't infer "verification" from `isPlaying()`** (Gemini, correct).

## Approach — four commits, each with its tests

1. **`apiFetch` header merge + method-aware retry** (`src/config/api.ts`, new `tests/api-fetch.test.ts` with `vi.stubGlobal('fetch')`).
   - Build `init = { ...options, headers: { Accept: 'application/json', ...normalizeHeaders(options.headers) }, signal }`. `normalizeHeaders` handles `undefined`, plain objects, `Headers` and `[k, v][]`.
   - Retry only GET/HEAD/PUT/DELETE (no method = GET).
   - Tests: Accept is kept with a plain object, a `Headers` instance and tuple headers; POST that gets a 500 or a rejection is fetched once; GET 500 → 200 is fetched twice.
2. **`EventBus` handler isolation** (`src/core/event-bus.ts`, `tests/event-bus.test.ts`).
   - try/catch per handler inside the existing snapshot loop. Keep the snapshot reuse; the success path adds no allocation.
   - A throw → `bootError` + a strike on the stored handler record (strike state lives on the stored record, not a new map). Same window rule as visuals.
   - Quarantine records are collected and **emitted after the loop** as `'handler:quarantined' { event, message }`. The literal must appear in `src` for `tests/event-map-drift.test.ts`. Don't emit re-entrantly.
   - In the contact-batch subscriber (`physics-controller.ts:142`) and the Rapier drain callback (`physics.ts:407` → `runTick`), wrap the **per-contact** body. One bad contact no longer drops the rest of that step. Report a contact fault as a **sim-phase fault** (decision 1).
   - Tests: the second handler still runs after the first throws; one throw then success stays subscribed; 3 throws in the window → removed + one `handler:quarantined`; off() during emit still works; `dispatchSnapshot(event)` returns the same array across two unchanged emits.
3. **Scheduler fault domains** (`src/core/frame-scheduler.ts`, `tests/frame-scheduler.test.ts`, `src/replay/replay-runner.ts`, `src/game.ts` wiring only).
   - `FrameSystem.name` becomes required (all 9 registrations already pass one). try/catch per `update`, with the window bitmask on `Entry`.
   - Non-sim phases quarantine via the existing `remove(entry)`, plus `bootError` and a `'system:quarantined' { phase, name, message }` emitted after the phase loop.
   - `physics`/`sim` throws call an injected `onSimFault({ phase, name, message })`. `Game` implements it: mark the run unranked; if `replayRunner.isStrict()`, `replayRunner.reject('sim-fault', message)`; at 3-in-8, end the game.
   - A throw never skips the **other** systems of that phase or later phases, and the frame always returns to Babylon.
   - Tests:
     - a throwing visuals system is removed on its 3rd throw in 8 frames and the hud system still runs on every frame;
     - an alternating thrower is quarantined (the window catches it);
     - a sim throw calls `onSimFault` and isn't removed;
     - strict runner + sim throw → `getRejection()` set and playback stopped;
     - non-strict → still playing.
4. **Arcade idempotency** (`src/arcade/arcade-api.ts`, `supabase/functions/{submit-score,submit-replay}/index.ts`, `supabase/functions/_shared/arcade.ts`, new migration + pgTAP test, `docs/API_CONTRACT.md`, `docs/api/arcade.openapi.yaml`, `tests/arcade-contract.test.ts`).
   - `submissionId` on `QueuedRun`, created in `submitRun`. Keys are `${submissionId}:replay` / `${submissionId}:score`. `replay_id` is written back to the queued run.
   - The functions claim the key before inserting and return the stored response on conflict. Add a `ranked: false` field accepted by `submit-score` for unranked runs, which never enter the verification queue.
   - Tests:
     - Vitest: a timeout after the server committed → queued → flushed → the second call carries the same key; a flush after a replay-only success doesn't upload the replay again.
     - pgTAP: a duplicate key returns the first response and inserts no row.
     - The contract test covers the new header and field.

## Acceptance criteria

- [ ] A system that throws in `visuals`/`render`/`hud`/`idle`/`input` on 3 of any 8 frames is removed. Every other system keeps running every frame, and the loop never stops (Vitest with a fake engine).
- [ ] A `physics`/`sim` throw is never silently removed. It marks the run unranked. Under a strict runner it rejects the playback on the first throw (Vitest).
- [ ] One throwing EventBus handler or contact doesn't stop the remaining handlers/contacts of that emit/step (Vitest, WASM batch and Rapier drain both covered).
- [ ] An emit with an unchanged handler set still allocates nothing new (the snapshot identity test).
- [ ] `apiFetch` keeps `Accept` for all three header shapes and never retries POST (Vitest).
- [ ] A finished run produces exactly one `replays` row and one `scores` row across: success; timeout-after-commit then flush; replay-ok/score-timeout then flush (Vitest + pgTAP).
- [ ] The verifier rejects a tape whose strict playback hit a sim fault, even with a matching score (`npm run test:verifier`).
- [ ] Golden tapes are unchanged: `npm run verify:replay` passes without `--update`. Isolation only adds catch paths, and no tape throws.
- [ ] `tsc -b`, lint, `check:index-strict` (covers `src/core`, `src/game/physics`), `check:unknown-casts`, vitest, `npm run build`, `check:bundle` (`entryGzipKb` within budget), `supabase test db`.

## Out of scope

Player-facing toasts mid-frame; snapshot/rollback of the C++ world (#504); worker supervision (#503 A2); telemetry endpoint (#503 A5); `ZoneTriggerSystem.emit`'s existing isolation (leave it).

## Remaining questions for Noah

1. Is 3-in-8 the right window, and should a live sim fault end the game at 3-in-8, or only mark the run unranked and continue?
2. `ranked: false` scores: show them on the board flagged, or don't store them at all?
3. TTL for `submission_keys` rows: 7 days (longer than any offline queue realistically sits)?
