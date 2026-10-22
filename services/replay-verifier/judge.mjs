/**
 * The verdict on one claimed score (#444 Slice C) — pure, so it is unit-tested
 * on its own (tests/replay-verifier-judge.test.ts).
 *
 * A claim is a row of `claim_score_verifications`: { score_id, score, map_id,
 * replay_id, payload, physics_engine, attempts, challenge_* }. A result is what
 * scripts/lib/replay-harness.mjs `runTape(…, 'verify', …)` returned.
 */

/** Only the in-process owner replays step-exactly (docs/determinism-todo.md). */
export const VERIFIABLE_ENGINE = 'wasm-owner'
/** Verifier-side failures (boot, browser) are retried this many times before the run is rejected. */
export const MAX_ATTEMPTS = 3

/**
 * The leaderboard a replay's table belongs to — `DailyCascadeState.getLeaderboardMapId`:
 * a cascade table has its own board, the vanilla table uses the map id.
 */
export function boardFor(payload) {
  const cascade = payload?.cascade
  if (cascade?.mode === 'daily') return `daily-cascade-${cascade.seedId}`
  if (cascade?.mode === 'free') return `free-cascade-${(Number(cascade.seed) >>> 0).toString(16)}`
  return payload?.mapId ?? null
}

const reject = (reason, verifierScore = null, stateHash = null) => ({ verdict: 'rejected', reason, verifierScore, stateHash })

/**
 * Whether a tape was played on its challenge's table (Slice D): the
 * challenge's session seed and, when it has one, its cascade table. Null when
 * it was, else the reason.
 */
function challengeMismatch(claim) {
  const payload = claim.payload
  if (Number(payload.seed) !== Number(claim.challenge_seed)) {
    return `not played on the challenge's table: session seed ${payload.seed}, the challenge's is ${claim.challenge_seed}`
  }
  const cascadeSeed = payload.cascade?.mode === 'free' ? Number(payload.cascade.seed) : null
  const wanted = claim.challenge_cascade_seed === null || claim.challenge_cascade_seed === undefined ? null : Number(claim.challenge_cascade_seed)
  if (cascadeSeed !== wanted) {
    return `not played on the challenge's table: cascade ${cascadeSeed ?? 'none'}, the challenge's is ${wanted ?? 'none'}`
  }
  return null
}

/** A reason the run can never verify, decided before replaying it; null to replay it. */
export function precheck(claim) {
  if (!claim.replay_id || !claim.payload) return reject('no replay')
  if (claim.physics_engine !== VERIFIABLE_ENGINE) {
    return reject(`unverifiable engine ${claim.physics_engine}: ranked runs are recorded on ${VERIFIABLE_ENGINE}`)
  }
  if (!claim.payload.initialSnapshot) return reject('no frame-0 snapshot on the tape')
  if (claim.challenge_id) {
    const mismatch = challengeMismatch(claim)
    if (mismatch) return reject(mismatch)
  }
  // A weekly run has the week's own board; any other run, its table's.
  const board = claim.challenge_kind === 'weekly' ? claim.challenge_board : boardFor(claim.payload)
  if (board !== claim.map_id) return reject(`submitted to ${claim.map_id}, but the tape was played on ${board}`)
  return null
}

/**
 * `verified` when the tape replays to the submitted score, `rejected` with
 * the reason when it cannot, `retry` when the verifier itself failed and
 * attempts remain.
 */
export function judge(claim, result, { verifierVersion = null, maxAttempts = MAX_ATTEMPTS } = {}) {
  const recordedOn = claim.payload?.buildId
  const onOtherBuild = recordedOn && verifierVersion && recordedOn !== verifierVersion ? ` (recorded on build ${recordedOn})` : ''
  if (!result.ok) {
    switch (result.code) {
      case 'snapshot':
        return reject(
          result.outcome === 'table-mismatch'
            ? `table not recognised: the tape's table descriptor hash does not match any table this build builds${onOtherBuild}`
            : `${result.reason}${onOtherBuild}`,
        )
      case 'rejected':
        return reject(`${result.reason}${onOtherBuild}`)
      case 'incomplete':
        return reject(`${result.reason}${onOtherBuild}`, result.score ?? null)
      default:
        // boot | start | setup | harness: the verifier's failure, not the run's.
        return claim.attempts >= maxAttempts
          ? reject(`verifier error after ${claim.attempts} attempts: ${result.reason}`)
          : { verdict: 'retry', reason: result.reason, verifierScore: null, stateHash: null }
    }
  }
  if (result.score !== Number(claim.score)) {
    return reject(`score mismatch: the tape replays to ${result.score}, ${claim.score} was submitted${onOtherBuild}`, result.score, result.finalStateHash)
  }
  return { verdict: 'verified', reason: null, verifierScore: result.score, stateHash: result.finalStateHash, ghost: result.ghost ?? null }
}
