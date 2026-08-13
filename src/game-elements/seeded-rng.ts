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
  getSessionSeed,
  resetSessionRng,
  isSessionRngInitialized,
  DEV_DEFAULT_SESSION_SEED,
  type SeededRng,
} from '../core/seeded-rng'
