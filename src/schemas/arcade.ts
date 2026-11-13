/**
 * Arcade service responses and the client's own arcade storage, as Valibot
 * schemas (#505 §A): every body `arcade-api.ts` reads from Supabase is parsed,
 * not cast. They mirror the response schemas of `docs/api/arcade.openapi.yaml`
 * (`tests/arcade-contract.test.ts` holds the two side by side). A response
 * object keeps only the fields named here, so a column the service adds later
 * is ignored rather than refused; a field the client reads that is missing or
 * mistyped fails the request as a 502.
 *
 * Loaded with `arcade-api.ts` (lazy: leaderboard, game over, spectate), never at boot.
 */

import * as v from 'valibot'

const str = () => v.string()
const nullableStr = () => v.nullable(v.string())
const n = () => v.number()

// ------------------------------------------------------------------ session

/** The anonymous player session `arcade-api.ts` keeps in `localStorage`. */
export const ArcadeSessionSchema = v.object({
  access_token: str(),
  refresh_token: str(),
  /** Seconds since the epoch. */
  expires_at: n(),
  user_id: str(),
})
export type ArcadeSession = v.InferOutput<typeof ArcadeSessionSchema>

const nonEmpty = () => v.pipe(v.string(), v.minLength(1))

/** Supabase Auth's answer to signup / refresh (OpenAPI `Session`). */
export const AuthSessionResponse = v.object({
  access_token: nonEmpty(),
  refresh_token: nonEmpty(),
  expires_in: v.optional(n()),
  expires_at: v.optional(n()),
  user: v.object({ id: nonEmpty() }),
})

// -------------------------------------------------------------------- reads

export const LeaderboardEntrySchema = v.object({
  rank: n(),
  name: str(),
  score: n(),
  map_id: str(),
  adventure_level: v.optional(nullableStr()),
  balls: n(),
  combo_max: n(),
  date: str(),
  replay_id: v.optional(nullableStr()),
  challenge_id: v.optional(nullableStr()),
  /** Replayed and confirmed by the verifier (Slice C). */
  verified: v.optional(v.boolean()),
})
export type LeaderboardEntry = v.InferOutput<typeof LeaderboardEntrySchema>

export const ReplayRowSchema = v.object({ payload: v.record(v.string(), v.unknown()) })

export const CloudSaveSchema = v.object({
  slot: str(),
  schema_version: n(),
  data: v.unknown(),
  updated_at: str(),
})
export type CloudSave = v.InferOutput<typeof CloudSaveSchema>

export const LinkCodeSchema = v.object({ code: str(), expires_at: str() })

/** A nullable column the contract does not promise: absent reads as null. */
const orNull = <S extends v.GenericSchema>(schema: S) => v.optional(v.nullable(schema), null)

export const ArcadeChallengeSchema = v.object({
  id: str(),
  kind: v.picklist(['player', 'weekly']),
  seed: n(),
  map_id: str(),
  target_score: n(),
  challenger_name: orNull(str()),
  replay_id: orNull(str()),
  cascade_seed: orNull(n()),
  /** The board its runs submit to (weekly); null for a player's challenge. */
  board: orNull(str()),
  title: orNull(str()),
  starts_at: str(),
  expires_at: orNull(str()),
})
export type ArcadeChallenge = v.InferOutput<typeof ArcadeChallengeSchema>

const ghostEntries = {
  stride: n(),
  samples: n(),
  /** Base64 little-endian Int32 millimetre triples. */
  track: str(),
}

/** The verifier's recording of a verified run's ball: the race ghost. */
export const GhostTrackSchema = v.object(ghostEntries)
export type GhostTrack = v.InferOutput<typeof GhostTrackSchema>

export const LeaderboardReplayIdSchema = v.object({ replay_id: nullableStr() })

/** A weekly tournament: this week's table, or one in the archive. */
export const TournamentSchema = v.object({
  challenge_id: str(),
  board: str(),
  title: nullableStr(),
  seed: n(),
  cascade_seed: v.nullable(n()),
  map_id: str(),
  starts_at: str(),
  expires_at: str(),
  /** When its results were frozen; null while open or verifying. */
  frozen_at: nullableStr(),
  /** open: inside the week · verifying: ended, runs still being verified · final: results frozen. */
  status: v.picklist(['open', 'verifying', 'final']),
  entries: n(),
  leader_name: nullableStr(),
  leader_score: v.nullable(n()),
})
export type Tournament = v.InferOutput<typeof TournamentSchema>

/** One player's best verified run on a tournament board. */
export const TournamentStandingSchema = v.object({
  challenge_id: str(),
  board: str(),
  rank: n(),
  name: str(),
  score: n(),
  replay_id: nullableStr(),
  played_at: str(),
  /** Frozen results (true), or this week's live standings. */
  final: v.boolean(),
  /** The requesting player's own row. */
  mine: v.boolean(),
  /** The verifier recorded this run's ghost. */
  has_ghost: v.boolean(),
})
export type TournamentStanding = v.InferOutput<typeof TournamentStandingSchema>

/** A top run's race ghost, with who played it. */
export const TournamentGhostSchema = v.object({
  ...ghostEntries,
  rank: n(),
  name: str(),
  score: n(),
  replay_id: str(),
})
export type TournamentGhost = v.InferOutput<typeof TournamentGhostSchema>

/** A live run: its tape's frame-0 header and how far it has streamed. */
export const LiveRunSchema = v.object({
  id: str(),
  map_id: str(),
  player_tag: nullableStr(),
  chunk_steps: n(),
  track_stride: n(),
  chunks: n(),
  frames: n(),
  score: n(),
  /** live: streaming · left: the player started another run · ended: its final chunk is stored. */
  status: v.picklist(['live', 'left', 'ended']),
  created_at: str(),
  updated_at: str(),
  /** ReplayRecorder metadata at frame 0, without frames (fetchLiveRun only). */
  header: v.optional(v.record(v.string(), v.unknown())),
})
export type LiveRun = v.InferOutput<typeof LiveRunSchema>

/**
 * One chunk of a live tape: frames [start_frame, start_frame + frame_count)
 * as RLE rows, the C++ world's state hash and the score after its last step,
 * and the primary ball's path over it (base64 Int32 millimetre triples, one
 * every `track_stride` steps; null when the ball's path was not sampled).
 */
export const LiveChunkSchema = v.object({
  seq: n(),
  start_frame: n(),
  frame_count: n(),
  frames: str(),
  state_hash: str(),
  score: n(),
  track: nullableStr(),
  final: v.boolean(),
})
export type LiveChunk = v.InferOutput<typeof LiveChunkSchema>

// ------------------------------------------------------------------- writes

export const SubmitReplayResponse = v.object({ replay_id: str() })
export const SubmitScoreResponse = v.object({ rank: n(), score_id: n() })
export const CreateChallengeResponse = v.object({ challenge_id: str() })
export const PutSaveResponse = v.object({ updated_at: str() })

/** What a finished run submits (OpenAPI `ScoreSubmission`); also what the offline queue stores. */
export const ScoreSubmissionSchema = v.object({
  name: str(),
  score: n(),
  map_id: str(),
  adventure_level: v.optional(str()),
  balls: n(),
  combo_max: n(),
  replay_id: v.optional(str()),
  challenge_id: v.optional(str()),
  /**
   * False for a run that hit a physics / sim fault (#503 A3): stored, but never verified and never
   * on a board. Absent means ranked.
   */
  ranked: v.optional(v.boolean()),
})
export type ScoreSubmission = v.InferOutput<typeof ScoreSubmissionSchema>

/** A run waiting for the network in `localStorage`. */
export const QueuedRunSchema = v.object({
  score: ScoreSubmissionSchema,
  /** Dropped once uploaded: `score.replay_id` then cites it. */
  replay: v.optional(str()),
  queuedAt: str(),
  /**
   * One per finished run (#503 A4), kept while it waits in the queue: every attempt sends the same
   * `Idempotency-Key`s (`<id>:replay`, `<id>:score`), so a run the service already stored — a
   * timeout after the commit — is not stored twice. Absent on runs queued by older builds.
   */
  submissionId: v.optional(str()),
})
export type QueuedRun = v.InferOutput<typeof QueuedRunSchema>

/** The queue as stored; a malformed entry drops the queue rather than a run half-read. */
export const QueuedRunsSchema = v.array(QueuedRunSchema)
