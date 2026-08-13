/**
 * @deprecated Import from `../core/seeded-rng` instead. Re-exported for barrel compatibility.
 */
export {
  createSeededRng,
  hashStringToSeed,
  dailySeedId,
  seedFromDailyId,
  randomU32Seed,
  initSessionRng,
  getSessionRng,
  getSessionRngFork,
  getSessionSeed,
  resetSessionRng,
  isSessionRngInitialized,
  DEV_DEFAULT_SESSION_SEED,
  RNG_FORK,
  type SeededRng,
  type RngForkLabel,
} from '../core/seeded-rng'
