/**
 * The C++ owner world with nothing else around it (#528): what `PhysicsSystem` sets up for the
 * `wasm-owner` mode — gravity, rolling resistance, a `WasmTableWorld` the table is authored into —
 * and its owner-mode `step`, which is the bare engine step (contacts reach the dispatcher through
 * the event bus, `engine.init`). No Rapier, no Babylon, no worker.
 */

import type { PhysicsApi, PhysicsWorldSink } from '../core/physics-api'
import { GRAVITY } from '../core/collision-groups'
import { WASM_PHYSICS } from '../config'
import type { WasmPhysicsEngine } from '../wasm/PhysicsModule'
import { WASM_PHYSICS_API } from '../wasm/wasm-physics-api'
import { WasmTableWorld } from '../wasm/wasm-table-world'
import type { PhysicsSim } from '../game/physics/types'

export class HeadlessPhysics implements PhysicsSim {
  readonly tableWorld: WasmTableWorld
  private mirrorOverheadMs = 0

  constructor(readonly engine: WasmPhysicsEngine) {
    if (!engine.isReady) throw new Error('HeadlessPhysics: the C++ engine is not loaded')
    engine.setGravity(GRAVITY.x, GRAVITY.y, GRAVITY.z)
    engine.setRollingResistance(WASM_PHYSICS.tunables.rollingResistance)
    this.tableWorld = new WasmTableWorld(engine, GRAVITY)
  }

  getWorld(): PhysicsWorldSink {
    return this.tableWorld
  }

  getPhysicsApi(): PhysicsApi {
    return WASM_PHYSICS_API
  }

  getWasmTableWorld(): WasmTableWorld {
    return this.tableWorld
  }

  getWasmEngine(): WasmPhysicsEngine {
    return this.engine
  }

  isWasmActive(): boolean {
    return this.engine.isReady
  }

  isWasmOwnerMode(): boolean {
    return this.engine.isReady
  }

  getWasmMode(): 'wasm-owner' {
    return 'wasm-owner'
  }

  /** `PhysicsSystem.step` on the owner path: one engine step; the alpha it reports. */
  step(rawDt: number): number {
    return this.engine.step(rawDt)
  }

  getLastMirrorOverheadMs(): number {
    return this.mirrorOverheadMs
  }

  setMirrorOverheadMs(ms: number): void {
    this.mirrorOverheadMs = ms
  }

  setWasmDebugColliders(): void {}

  setEngineSwitchListener(): void {}
}
