# #526 (expanded): typed, pooled voice worklet generated from `src/audio/`

Expanded 2026-11-12 from #526, with review passes by Gemini (two runs), gpt-oss-120b and Grok. Every repo claim below was re-checked against `main` at `26d8383`; anything a review said that did not hold up is listed under "Review disposition" at the end.

## Why

`public/audio/pachinko-voice-processor.js` (79 lines) is the only hand-written application JavaScript left. #521 slice 4 starts looped music stems on the same `AudioContext` and sample clock, so the voice path has to be typed, bounded and allocation-free before then. Re-checking the code also turned up two DSP bugs and a lifecycle leak that #526 does not mention.

**Presentation only.** Nothing here reads or writes sim state. No golden tape, replay, or C++ change.

## What is wrong today (verified)

| # | Where | Problem |
|---|---|---|
| 1 | `pachinko-voice-processor.js:22-32` | Allocates a voice object for every hit and `shift()`s out the **oldest** voice once there are more than 24, however loud it is. `process()` `splice`s finished voices (`:68`). |
| 2 | `:14-20` | Every field is re-parsed with `Number(data.x) ?? default`. `Number()` never returns null, so the `??` defaults never apply: a missing `metal` becomes 0 instead of 0.5. |
| 3 | `:58` | **One shared `this.phase`** for the ring oscillator, advanced once per sample *per live voice*. The ring pitch therefore scales with how many voices are playing (two voices → double pitch). **DSP bug.** |
| 4 | `:48` | The 1-pole filter state `y` is a local reset to 0 for each voice in each `process()` call, so the filter restarts every 128 samples. That is a discontinuity at every quantum boundary. **DSP bug.** |
| 5 | `audio-engine.ts:161` / `sound-system-synth.ts:366` | Pan is `x / 12` on the worklet path but `x / 8` on the oscillator fallback. The playfield is 28 wide (`GameConfig.table.width`, `src/config/game-config.ts:32`), so its half-width is 14. Neither path uses it. |
| 6 | `sound-system-synth.ts:222` | `playImpact` allocates a `workletTypes` array on every call. `playVoice` (`audio-engine.ts:162`) allocates an object literal per hit, which `postMessage` then structured-clones. That is two allocations per contact on the main thread. |
| 7 | `effects-core.ts:152-155`, `sound-system-context.ts:193`, `sound-system.ts:391` | **Lifecycle leak.** `EffectsSystem`'s constructor creates the `AudioEngine` singleton (and its `AudioContext`). The only path that disposes it is `SoundSystem.dispose()`, which runs only if `SoundSystem.init()` set `state.audioContext`. A Game disposed before Start (e.g. in the menu) hands its `AudioEngine` to the next Game. Nothing calls `resetAudioEngine()` (`audio-engine.ts:219`). In addition, `AudioEngine.dispose()` (`:192-204`) clears the singleton only after `await context.close()`, never closes the worklet `port`, and never resets `workletPromise` / `workletFailed`. |
| 8 | `sound-system-synth.ts:228` | The only direct `playVoice` caller. `EffectsSystem.playVoice` (`effects-core.ts:336`) has no callers. Of the `playImpact` call sites for worklet categories, `collision-handlers.ts:124/156/192` pass a position. `collision-handlers.ts:322` (lane rollover) **has `pos` in hand but does not pass it**. `collision-dispatch.ts:566` (contact-force pegs, the bulk of pin hits) and `scoring-bridge.ts:350` (drain) have no position. |

## Design decisions

1. **One contract, binary on the wire.** `src/audio/voice-hit.ts` exports:
   - `interface VoiceHit { velocity; impact; metal; spin; fever; pan }`, all pre-clamped numbers;
   - `VOICE_HIT_STRIDE = 6` and the field offsets;
   - `VOICE_POOL_SIZE = 24` and `VOICE_BATCH_CAPACITY = 64`;
   - `writeVoiceHit(buf, index, hit)`.

   Both sides import this module: `AudioEngine` and the processor. esbuild inlines it into the worklet IIFE.
2. **Batch per task instead of one message per hit.**
   - `AudioEngine` keeps one preallocated `Float32Array(VOICE_BATCH_CAPACITY * STRIDE)`.
   - `playVoice` writes into it and, on the first hit of a task, schedules one flush with `queueMicrotask(this.flushBound)` (a pre-bound method, so no closure per hit).
   - The flush posts `batch.slice(0, n * STRIDE)`. That is one allocation and one message per frame, not per hit. If the batch fills up, it flushes immediately.
   - The frame scheduler runs in one task, so this sends about one message per frame and adds well under a frame of latency. The audio thread only renders at quantum boundaries anyway.
3. **No SharedArrayBuffer ring yet.** COOP/COEP are served in dev, preview and on the live host, but `crossOriginIsolated` is not guaranteed on every path that boots the game, so a SAB transport would need this postMessage path as a fallback anyway. Revisit in #521 slice 4 if profiling shows the per-frame message matters.
4. **Fixed pool as struct-of-arrays, allocated once in the constructor.**
   - Fields: `samplesLeft`, `total`, `seed` (`Int32Array`); `impact`, `metal`, `spin`, `fever`, `pan`, `filterY` (`Float32Array`); `phase` (`Float64Array`).
   - **Per-voice `phase` and `filterY` fix bugs 3 and 4.** They change the sound, and the PR says so.
5. **Steal policy (the test oracle).** A voice's current gain is `impact * env²` with `env = samplesLeft / total`, matching today's envelope. A new hit goes to:
   - the lowest-index free slot (`samplesLeft <= 0`) if there is one;
   - otherwise, the live voice with the lowest current gain (ties go to the lowest index), but only if the new hit's `impact` is greater than that gain;
   - otherwise, nowhere: the hit is dropped.

   Never cutting a louder voice for a quieter hit also avoids most steal clicks, so no crossfade is needed. Gold-ball and jackpot sounds don't go through this worklet (they use the sample bank and oscillators), so no immunity flag is needed.
6. **Pan from one helper.** `panForX(x) = clamp(x / (GameConfig.table.width / 2), -1, 1)` is used by both the worklet path and `createOptionalStereoPanner`.
   - This replaces `/12` and `/8`, so **the mix changes (intentional; call it out)**.
   - Reduced-audio scaling (`* 0.45` velocity, `* 0.35` pan) stays on the main thread.
   - No position means pan 0 on the worklet path; the fallback keeps its ±0.15 random pan.
   - No per-cabinet plumbing: all four builders use a 28-wide playfield. Removing their local `playfieldW = 28` copies is a `src/cabinet` follow-up, not part of this issue.
7. **Position wiring, minimal.**
   - Pass the existing `pos` at `collision-handlers.ts:322`. That is the only `src/game/physics/**` edit.
   - Positions for `collision-dispatch.ts:566` (contact-force pegs) wait for #523's allocation-free `getBallPosition(out)`. Reading `translation()` per contact today would put an allocation back on the hot path.
   - The obstacle `sound:play` path is out of scope too.
   - File both as follow-ups.
8. **Typings: a local `src/audio/worklet/worklet-globals.d.ts`** (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, a minimal `MessagePort`) under a new `tsconfig.worklet.json` (`lib: ["ES2022"]`, `types: []`, `noUncheckedIndexedAccess`, `noImplicitOverride`). It is referenced from `tsconfig.json`, and `src/audio/worklet` is added to `tsconfig.app.json`'s `exclude` so the worklet globals never reach the DOM project. If the `.d.ts` grows past ~40 lines, switch to `@types/audioworklet`.
9. **Generation.**
   - `scripts/build-audio-worklet.mjs` runs esbuild with `bundle`, `format: 'iife'`, `target: 'es2022'`, no imports left, and the banner `// GENERATED from src/audio/worklet — do not edit`. It writes `public/audio/pachinko-voice-processor.js`; `--check` regenerates in memory and fails on any byte difference.
   - **Add `esbuild` as an explicit devDependency pinned to `0.25.12`** (today it is only a transitive dependency of Vite 7).
   - Scripts: `build:worklet`, `check:worklet`, `predev: npm run build:worklet`. `build` and `build_colab` run `build:worklet` before `build:wasm`.
   - CI: one `npm run check:worklet` step in the `check` job, before the build.
   - The generated file stays committed: `vite dev`, Playwright's `webServer` and `preview-subdir.spec.ts` serve it as-is.
   - The filename and `WORKLET_PATH` don't change (`asset-urls.test.ts` and `preview-subdir.spec.ts` assert them).
   - Workbox already precaches it through `globPatterns` (`vite.config.ts:328`), so `vite.config.ts` doesn't change.
10. **The processor is quantum-size agnostic.** It loops to `outputs[0][0].length` and never assumes 128, so a later `renderSizeHint` change just works.
11. **Dispose (fixes bug 7).**
    - `AudioEngine.dispose()` is idempotent. It clears the singleton and decrements the owned count **synchronously, before** awaiting `close()`. It also sets `port.onmessage = null`, calls `port.close()`, resets `workletPromise` / `workletFailed`, and drops the pending batch.
    - `disposeGame` calls `void resetAudioEngine()` right after `resetSoundSystem()` (`game-disposer.ts:130`), and `tests/game-disposer-resets.test.ts` pins it.
    - The guarded call in `sound-system-context.ts:193` stays and is harmless once dispose is idempotent.

## Proving "no allocation"

A Node heap delta is flaky, and `--expose-gc` does not make it deterministic, so the proof has two deterministic layers.

1. **Lint (static).** Add an ESLint `no-restricted-syntax` block scoped to `src/audio/worklet/**/*.ts`. Inside methods named `process` or `handleMessage`, it bans:
   - `NewExpression`, `ObjectExpression`, `ArrayExpression`;
   - arrow and function expressions;
   - `TemplateLiteral`, `SpreadElement`;
   - calls to `Number(…)`;
   - member calls to `push`, `shift`, `splice`, `slice`, `map`, `filter`, `concat`.

   It runs on the TypeScript source, so it is deterministic.
2. **Runtime (Vitest).** Stub `AudioWorkletProcessor` / `registerProcessor` / `sampleRate = 48000`, then dynamically import the processor TS. After construction, replace `Float32Array`, `Float64Array`, `Int32Array` and `Array` on `globalThis` with constructors that throw. Then:
   - post a 500-hit burst as batches and run 1000 quanta;
   - assert that nothing threw;
   - assert the live voice count is ≤ 24 throughout;
   - assert every SoA array is the same object (`toBe`) before and after;
   - assert each steal hits the slot the oracle in decision 5 predicts.

The structured-clone allocation of the delivered message event is unavoidable and accepted: one per batch, not per hit. On the main thread, `playVoice` with 100 hits in one task calls `port.postMessage` exactly once, and `playImpact` no longer builds arrays or objects per call. The same lint rule applies to `playVoice` / `writeVoiceHit` through a selector on `src/audio/audio-engine.ts`.

## Commits (one PR, `claude/526-voice-worklet`)

1. **Contract + generator.** `voice-hit.ts`, `worklet-globals.d.ts`, `tsconfig.worklet.json` (+ reference, + app exclude), `scripts/build-audio-worklet.mjs`, the esbuild devDependency, package scripts, and the CI step.
   Verify: `npx tsc -b && npm run build:worklet && npm run check:worklet && npm run lint`.
2. **Processor in TS.** The SoA pool, the steal policy, per-voice `phase` / `filterY`, and the lint block. The generated JS is regenerated in the same commit.
   Verify: `npx tsc -b && npm run lint && npm run check:worklet && npm run check:index-strict`.
3. **Engine side.** Per-task batching in `playVoice`, `panForX` in both paths, the hoisted `workletTypes`, and the lane-rollover `pos`.
   Verify: `npx vitest run tests/audio-engine.test.ts tests/sound-system.test.ts`.
4. **Dispose.** Idempotent synchronous detach, port close, and `resetAudioEngine()` in `disposeGame`.
   Verify: `npx vitest run tests/audio-engine.test.ts tests/game-disposer-resets.test.ts`, then `npx playwright test tests/lifecycle-dispose.spec.ts --trace off`.
5. **Tests.** `tests/pachinko-voice-processor.test.ts` (burst, oracle, allocation traps, drift) and additions to `tests/audio-engine.test.ts` (one message per task, `panForX`, `getOwnedAudioContextCount()` stays 1 across boot → `ensureWorklet` and drops to 0 after `resetSoundSystem()` + `resetAudioEngine()` even when `SoundSystem.init()` never ran).
   Final: `npx tsc -b && npm run lint && npm run check:index-strict && npx vitest run && npx vite build && npm run check:bundle && npm run check:worklet`, then `npx playwright test tests/preview-subdir.spec.ts tests/verify_prism_core.spec.ts --trace off`.

## Acceptance

- [ ] Every `.js` under `public/audio/` carries the GENERATED banner. `check:worklet` passes locally and in CI, and fails after a one-byte manual edit (shown in the PR).
- [ ] `VoiceHit` (+ stride/offsets) is the only wire contract, imported by both sides. The processor has no `Number()` calls and no `??` defaults.
- [ ] 500-hit burst, 1000 quanta: the live count stays ≤ 24, typed-array identities are unchanged, the allocation traps never fire, and every steal matches the oracle (lowest gain, lowest index on ties, drop if the new impact ≤ the quietest gain).
- [ ] Each voice has its own ring phase and filter state. A test: with `Math.random` stubbed to a constant (so both voices get the same noise seed), two simultaneous voices with identical parameters produce exactly 2× the samples of one voice rendered alone. Today's shared `this.phase` fails this.
- [ ] One `postMessage` per task for any number of `playVoice` calls ≤ 64. `playImpact` / `playVoice` pass the scoped lint rule.
- [ ] Both pan paths use `panForX` with a half-width of 14. Neither `/ 12` nor `/ 8` is left. Lane-rollover hits pass their position.
- [ ] A Game disposed before Start leaves `getOwnedAudioContextCount() === 0`, and the next Game gets a fresh `AudioEngine`. `lifecycle-dispose.spec.ts` stays green.
- [ ] `check:bundle` passes with `chunks.entryGzipMaxKb` unchanged, and the PR records the measured entry delta. The processor is not imported by app code.
- [ ] `git diff --name-only origin/main` touches nothing under `src/wasm/`, `native/`, `tests/replays/`, or `vite.config.ts`, and only `collision-handlers.ts` (one argument) under `src/game/physics/`. If emcc 6.0.10 is available, `npm run verify:replay` passes. Otherwise say so in the PR; the Golden job is red on `main` until #519 A1 lands.

## Follow-ups to file (not this PR)

- Contact-force peg pan (`collision-dispatch.ts:566`) once #523 provides an allocation-free `getBallPosition(out)`.
- Positions on the obstacle `sound:play` path (`event-bus.ts` payload + `obstacle-eventbus-integration.ts` + the `src/objects/*` emitters).
- One exported playfield width for the four `src/cabinet/cabinet-*.ts` builders.
- SAB transport and `AudioContext.playbackStats` underrun monitoring, if #521 stems profiling asks for them.

## Review disposition

| Source | Claim | Taken? |
|---|---|---|
| Gemini (Antigravity) | Dispose leak when `SoundSystem.init()` never ran; detach before `await` | **Yes.** Verified, and widened: nothing calls `resetAudioEngine()`. |
| Gemini (Antigravity) | Per-cabinet `setPlayfieldHalfWidth` from `CabinetBuilder` | No. Every cabinet uses a 28-wide playfield; `GameConfig.table.width` already exists. |
| Gemini (Antigravity) | Thread positions through `sound:play` + 7 obstacle emitters | Deferred (follow-up). Too much surface for this PR. |
| Gemini (Antigravity) | `Object.freeze` + Array-prototype spies + regex over the generated IIFE | Partly. Lint on the TS source replaces the regex; constructor traps replace the spies. |
| Gemini (Antigravity) | esbuild is "already installed" | Only transitively (Vite 7 → 0.25.12); pinned explicitly here. |
| Gemini (Haiku) | No caller of `AudioEngine.dispose()` | Wrong. `sound-system-context.ts:194` calls it, but only behind the `state.audioContext` guard; that guard is the bug. |
| Gemini (Haiku) | Move `PLAYFIELD_WIDTH` into config and use it in the four builders | Config value already exists; builder dedupe deferred. |
| Gemini (Haiku) | Heap delta under `--expose-gc` | No; flaky. |
| Gemini (Haiku) | Define the steal oracle and tie-break; give numbers instead of "doesn't grow" | **Yes.** |
| gpt-oss-120b | Per-hit structured clone allocates; "zero alloc in onmessage" is unachievable as written | **Yes.** Led to per-task batching and the accepted one-clone-per-batch. |
| gpt-oss-120b | SAB ring as the primary transport | Deferred. `crossOriginIsolated` isn't guaranteed, so a fallback would be needed anyway. |
| gpt-oss-120b | Crossfade on steal | No. The "never cut a louder voice" rule removes the loud-cut case more cheaply. |
| gpt-oss-120b | Throwing typed-array constructors after warm-up | **Yes.** |
| Grok | Separate esbuild step and committed output are still best practice; AudioEngineV2 has no voice pool; be quantum-agnostic | **Yes.** No duplication with Babylon. |
| Grok | `@types/audioworklet` is maintained | Noted; local `.d.ts` first, switch past ~40 lines. Version claim not verified. |
| None of the four | Shared ring `phase` and per-quantum filter reset in today's processor | Found in re-verification. Fixed here as bugs 3 and 4. |
