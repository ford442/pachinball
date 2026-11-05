/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The build's commit (`-dirty` with local changes); stamped into replays (#444). */
declare const __PACHINBALL_BUILD__: string

/**
 * SHA-256 (hex) of the `PhysicsModule.wasm` this build ships; null on the dev server and in a
 * Rapier-only build. Stamped into replays so the verifier picks the same binary (#490 Slice B).
 */
declare const __PACHINBALL_WASM_SHA256__: string | null

/**
 * Globals the app writes on `window` for Playwright specs, the debug console and the boot
 * diagnostics. Declared once here so writers and readers need no `as unknown as Window` casts.
 */
interface Window {
  /** The live Game; read by Playwright specs and the diagnostic helper. */
  game?: import('./game').Game
  runVisibilityDiagnostic?: () => void
  /** Renderer actually in use (`exposeRenderer`). */
  currentRenderer?: string
  /** `?renderer=` / console override read by `renderer-selector`. */
  DEBUG_RENDERER?: string
  /** Engine that served the last physics init/step (`exposeCurrentPhysicsEngine`). */
  currentPhysicsEngine?: import('./config/physics').WasmPhysicsRuntimeMode
  /** Last physics degrade reason; absent when the selected engine booted. */
  physicsDegradeReason?: string
  /** Engine options the bootstrap resolved (`main.ts`). */
  bootstrapEngineOptions?: import('./engine/engine-options').ResolvedEngineOptions
  /** Console flag: create the engine with `preserveDrawingBuffer` (screenshots). */
  DEBUG_PRESERVE_DRAWING_BUFFER?: boolean
  /** Shared material library, exposed for console debugging. */
  materialLibrary?: import('./materials').MaterialLibrary
  /** Slot-machine debug hooks (`SlotMachine.exposeDebugGlobals`). */
  forceSlotSpin?: (forcedResult?: import('./display/slot-types').SlotSymbol[]) => void
  setSlotDebugForce?: (symbols: import('./display/slot-types').SlotSymbol[]) => void
  /** Backbox reels telemetry hooks (`DisplayReelsLayer.exposeDebugGlobals`). */
  setReelsTelemetryEnabled?: (enabled: boolean) => void
  getReelsTelemetry?: () => import('./display/display-reels').ReelsRenderTelemetrySnapshot
  resetReelsTelemetry?: () => void
}
