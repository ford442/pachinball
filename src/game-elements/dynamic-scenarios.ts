/**
 * Dynamic Adventure Mode - Example Scenarios
 *
 * Five complete themed scenarios with:
 * - Unique visuals (LCD colors, lighting, materials)
 * - Zone-specific mechanics
 * - Backbox story sequences
 * - Thematic music and audio
 *
 * Each scenario's data lives in ./scenarios/*.ts — this module owns the
 * registry lookup helpers and the fixed/dynamic mode-toggle state machine.
 */

export type { ScenarioZone, DynamicScenario } from './scenarios/types'
export { SAMURAI_REALM_SCENARIO } from './scenarios/samurai-realm'
export { CYBER_NOIR_SCENARIO } from './scenarios/cyber-noir'
export { QUANTUM_DREAM_SCENARIO } from './scenarios/quantum-dream'
export { MOVIE_GANGSTER_SCENARIO } from './scenarios/movie-gangster'
export { FANTASY_REALM_SCENARIO } from './scenarios/fantasy-realm'

import type { DynamicScenario } from './scenarios/types'
import { SAMURAI_REALM_SCENARIO } from './scenarios/samurai-realm'
import { CYBER_NOIR_SCENARIO } from './scenarios/cyber-noir'
import { QUANTUM_DREAM_SCENARIO } from './scenarios/quantum-dream'
import { MOVIE_GANGSTER_SCENARIO } from './scenarios/movie-gangster'
import { FANTASY_REALM_SCENARIO } from './scenarios/fantasy-realm'

// =============================================================================
// SCENARIO REGISTRY
// =============================================================================

export const DYNAMIC_SCENARIOS: Record<string, DynamicScenario> = {
  'samurai-realm': SAMURAI_REALM_SCENARIO,
  'cyber-noir': CYBER_NOIR_SCENARIO,
  'quantum-dream': QUANTUM_DREAM_SCENARIO,
  'movie-gangster': MOVIE_GANGSTER_SCENARIO,
  'fantasy-realm': FANTASY_REALM_SCENARIO,
}

export function getScenario(id: string): DynamicScenario | undefined {
  return DYNAMIC_SCENARIOS[id]
}

export function getAllScenarios(): DynamicScenario[] {
  return Object.values(DYNAMIC_SCENARIOS)
}

export function getScenarioIds(): string[] {
  return Object.keys(DYNAMIC_SCENARIOS)
}

// =============================================================================
// MODE TOGGLE
// =============================================================================

export type GameMode = 'fixed' | 'dynamic'

export interface ModeToggleState {
  currentMode: GameMode
  currentScenario: string | null
  isTransitioning: boolean
}

export function createDefaultModeState(): ModeToggleState {
  return {
    currentMode: 'fixed',
    currentScenario: null,
    isTransitioning: false,
  }
}

export function toggleGameMode(state: ModeToggleState): ModeToggleState {
  const newMode: GameMode = state.currentMode === 'fixed' ? 'dynamic' : 'fixed'
  return {
    ...state,
    currentMode: newMode,
    isTransitioning: true,
  }
}

export function setScenario(state: ModeToggleState, scenarioId: string): ModeToggleState {
  return {
    ...state,
    currentScenario: scenarioId,
    currentMode: 'dynamic',
    isTransitioning: true,
  }
}

export function completeTransition(state: ModeToggleState): ModeToggleState {
  return {
    ...state,
    isTransitioning: false,
  }
}
