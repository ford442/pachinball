/**
 * Game Physics Controller — thin re-export shim.
 *
 * The implementation has moved into `src/game/physics/physics-controller.ts`.
 * Existing importers continue to import from this path.
 */

export { GamePhysicsController } from './physics/physics-controller'
export type { PhysicsHost } from './physics/types'
export {
  getFeverScoreMultiplier,
  applyFeverGoldMultiplier,
} from './physics/scoring-multipliers'
