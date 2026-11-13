/**
 * Live arcade service client (#444 Slice B) — Supabase: PostgREST reads,
 * one Edge Function per write path, Supabase Auth anonymous sessions.
 * The contract is docs/API_CONTRACT.md + docs/api/arcade.openapi.yaml, and
 * tests/arcade-contract.test.ts holds every request this module makes to it.
 *
 * Loaded lazily (leaderboard overlay, game over, spectate): nothing here is
 * on the boot path. storage.noahcohn.com stays the asset CDN (`ASSET_BASE`).
 */

import * as v from 'valibot'
import { ARCADE_KEY, ARCADE_URL, arcadeEnabled } from '../config/arcade'
import {
  ArcadeChallengeSchema,
  ArcadeSessionSchema,
  AuthSessionResponse,
  CloudSaveSchema,
  CreateChallengeResponse,
  GhostTrackSchema,
  LeaderboardEntrySchema,
  LeaderboardReplayIdSchema,
  LinkCodeSchema,
  LiveChunkSchema,
  LiveRunSchema,
  PutSaveResponse,
  QueuedRunsSchema,
  ReplayRowSchema,
  SubmitReplayResponse,
  SubmitScoreResponse,
  TournamentGhostSchema,
  TournamentSchema,
  TournamentStandingSchema,
  type ArcadeChallenge,
  type ArcadeSession,
  type CloudSave,
  type GhostTrack,
  type LeaderboardEntry,
  type LiveChunk,
  type LiveRun,
  type QueuedRun,
  type ScoreSubmission,
  type Tournament,
  type TournamentGhost,
  type TournamentStanding,
} from '../schemas/arcade'
import { isRecord, parseJsonWith } from '../schemas/schema-kit'

export type {
  ArcadeChallenge,
  CloudSave,
  GhostTrack,
  LeaderboardEntry,
  LiveChunk,
  LiveRun,
  ScoreSubmission,
  Tournament,
  TournamentGhost,
  TournamentStanding,
}

export interface SubmitResult {
  success: boolean
  rank?: number
  score_id?: number
  /** The run's uploaded replay (a challenge cites it). */
  replay_id?: string
  /** Kept on this device and sent when the network is back. */
  queued?: boolean
  message?: string
}

/** A refused or failed arcade request; `offline` when the network never answered. */
export class ArcadeError extends Error {
  readonly status: number
  readonly offline: boolean
  constructor(message: string, status: number, offline = false) {
    super(message)
    this.status = status
    this.offline = offline
  }
}

const REQUEST_TIMEOUT_MS = 8000
const SESSION_KEY = 'pachinball:arcade-session'
const QUEUE_KEY = 'pachinball:arcade-queue'
const MAX_QUEUED_RUNS = 5

// ------------------------------------------------------------------ session

/** A stored value, parsed with `schema`; null when absent, unreadable or not of that shape. */
function readStore<S extends v.GenericSchema>(key: string, schema: S): v.InferOutput<S> | null {
  try {
    return parseJsonWith(schema, localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage disabled or full: the session / queue just does not persist.
  }
}

/** A response body that is not what the contract says: the service is broken, not the request. */
function parseBody<S extends v.GenericSchema>(path: string, schema: S, body: unknown): v.InferOutput<S> {
  const result = v.safeParse(schema, body)
  if (result.success) return result.output
  const issue = result.issues[0]
  const at = v.getDotPath(issue)
  throw new ArcadeError(`unexpected response from ${path.split('?')[0]}: ${at ? `${at}: ` : ''}${issue.message}`, 502)
}

/** `send`, its body parsed with `schema`. */
async function request<S extends v.GenericSchema>(
  path: string,
  schema: S,
  init: RequestInit & { token?: string } = {},
): Promise<v.InferOutput<S>> {
  return parseBody(path, schema, await send(path, init))
}

async function send(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  // Not "offline": a disabled build must not queue runs it will never send.
  if (!arcadeEnabled()) throw new ArcadeError('arcade service disabled in this build', 503)
  const { token, headers, ...rest } = init
  let res: Response
  let text: string
  try {
    res = await fetch(`${ARCADE_URL}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        apikey: ARCADE_KEY,
        Accept: 'application/json',
        ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    })
    // The timeout covers the body too: a reply that stalls halfway is no reply.
    text = await res.text()
  } catch (err) {
    throw new ArcadeError(err instanceof Error ? err.message : String(err), 0, true)
  }
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    // PostgREST and the functions say `message`, Supabase Auth says `msg`.
    const said: Record<string, unknown> = isRecord(body) ? body : {}
    const message = typeof said.message === 'string' ? said.message : typeof said.msg === 'string' ? said.msg : res.statusText
    throw new ArcadeError(message, res.status)
  }
  return body
}

function toSession(body: unknown): ArcadeSession {
  const parsed = v.safeParse(AuthSessionResponse, body)
  if (!parsed.success) throw new ArcadeError('auth answered without a session', 502)
  const b = parsed.output
  return {
    access_token: b.access_token,
    refresh_token: b.refresh_token,
    expires_at: b.expires_at ?? Math.floor(Date.now() / 1000) + (b.expires_in ?? 3600),
    user_id: b.user.id,
  }
}

let pendingSession: Promise<ArcadeSession> | null = null

/**
 * The player's anonymous session: reused while valid, refreshed when it
 * expires, created on first use. One player per browser profile.
 */
export function arcadeSession(): Promise<ArcadeSession> {
  pendingSession ??= (async () => {
    const stored = readStore(SESSION_KEY, ArcadeSessionSchema)
    const now = Math.floor(Date.now() / 1000)
    if (stored && stored.expires_at - 60 > now) return stored
    let next: ArcadeSession | null = null
    if (stored) {
      try {
        next = toSession(await send('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: stored.refresh_token }),
        }))
      } catch (err) {
        if (err instanceof ArcadeError && err.offline) throw err
        next = null // Revoked or expired refresh token: start a new anonymous player.
      }
    }
    next ??= toSession(await send('/auth/v1/signup', { method: 'POST', body: '{}' }))
    writeStore(SESSION_KEY, next)
    return next
  })().finally(() => {
    pendingSession = null
  })
  return pendingSession
}

// -------------------------------------------------------------------- reads

const LEADERBOARD_COLUMNS = 'rank,name,score,map_id,adventure_level,balls,combo_max,date,replay_id,challenge_id,verified'

/** Top `limit` rows of a board (map, optional adventure level), best first. */
export async function fetchLeaderboard(mapId: string, adventureLevel?: string, limit = 10): Promise<LeaderboardEntry[]> {
  const params = new URLSearchParams({
    select: LEADERBOARD_COLUMNS,
    map_id: `eq.${mapId}`,
    adventure_level: adventureLevel ? `eq.${adventureLevel}` : 'is.null',
    order: 'rank.asc',
    limit: String(limit),
  })
  return request(`/rest/v1/leaderboard?${params}`, v.array(LeaderboardEntrySchema))
}

/** Where `score` would place on the board (1 = top). */
export async function fetchPlayerRank(mapId: string, score: number, adventureLevel?: string): Promise<number> {
  return request('/rest/v1/rpc/player_rank', v.number(), {
    method: 'POST',
    body: JSON.stringify({ p_map_id: mapId, p_score: score, p_adventure_level: adventureLevel ?? null }),
  })
}

/** A stored replay's payload (what `ReplayRecorder.fromJSON` reads), or null when there is none. */
export async function fetchReplay(replayId: string): Promise<object | null> {
  const params = new URLSearchParams({ select: 'payload', id: `eq.${replayId}` })
  const rows = await request(`/rest/v1/replays?${params}`, v.array(ReplayRowSchema))
  return rows[0]?.payload ?? null
}

// ------------------------------------------------------------------- writes

async function callFunction<S extends v.GenericSchema>(name: string, schema: S, body: string, idempotencyKey?: string): Promise<v.InferOutput<S>> {
  const session = await arcadeSession()
  return request(`/functions/v1/${name}`, schema, {
    method: 'POST',
    body,
    token: session.access_token,
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  })
}

/**
 * Upload a replay (`ReplayRecorder.toJSON`), returning its id. With an `idempotencyKey`, a repeat
 * (a retry after a timeout the service had already committed) returns the first upload's id
 * instead of storing the tape again (#503 A4).
 */
export async function submitReplay(replayJson: string, idempotencyKey?: string): Promise<string> {
  const res = await callFunction('submit-replay', SubmitReplayResponse, replayJson, idempotencyKey)
  return res.replay_id
}

export async function createChallenge(challenge: {
  seed: number
  targetScore: number
  mapId: string
  challengerName?: string
  replayId?: string
  /** The free-seed cascade table it is played on; absent on the vanilla table. */
  cascadeSeed?: number
}): Promise<string> {
  const res = await callFunction('create-challenge', CreateChallengeResponse, JSON.stringify(challenge))
  return res.challenge_id
}

function newSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Non-secure contexts have no randomUUID; a key only has to be unique per player.
  const hex = (n: number): string => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`
}

/**
 * Send one run: the replay (unless already uploaded), then the score citing it. Updates `run` in
 * place as it goes — the uploaded replay's id is written back onto `run.score` and the tape is
 * dropped — so a run re-queued after a failed score call never uploads its replay again.
 */
async function sendRun(run: QueuedRun): Promise<SubmitResult> {
  const id = (run.submissionId ??= newSubmissionId())
  if (run.replay && !run.score.replay_id) {
    const replayId = await submitReplay(run.replay, `${id}:replay`)
    run.score = { ...run.score, replay_id: replayId }
    run.replay = undefined
  }
  const res = await callFunction('submit-score', SubmitScoreResponse, JSON.stringify(run.score), `${id}:score`)
  return { success: true, rank: res.rank, score_id: res.score_id, replay_id: run.score.replay_id }
}

/** Kept for the next flush: the network, a rate limit, or the service still finishing the same key. */
function retryable(err: unknown): boolean {
  return err instanceof ArcadeError && (err.offline || err.status === 429 || err.status === 409)
}

function queueRun(run: QueuedRun): void {
  const queue = readStore(QUEUE_KEY, QueuedRunsSchema) ?? []
  queue.push(run)
  writeStore(QUEUE_KEY, queue.slice(-MAX_QUEUED_RUNS))
}

/**
 * Submit a finished run: the replay first (when there is one), then the
 * score citing it. Without a network the run is queued on this device and
 * `flushQueuedRuns` sends it later, under the same idempotency keys.
 */
export async function submitRun(score: ScoreSubmission, replayJson?: string): Promise<SubmitResult> {
  const run: QueuedRun = { score, replay: replayJson, queuedAt: new Date().toISOString(), submissionId: newSubmissionId() }
  try {
    return await sendRun(run)
  } catch (err) {
    if (retryable(err)) {
      queueRun(run)
      const offline = (err as ArcadeError).offline
      return {
        success: false,
        queued: true,
        message: offline ? 'Offline: your score will be sent when you reconnect' : 'The arcade is busy: your score will be sent shortly',
      }
    }
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Runs waiting for the network. */
export function queuedRunCount(): number {
  return readStore(QUEUE_KEY, QueuedRunsSchema)?.length ?? 0
}

let flushing: Promise<number> | null = null

/**
 * Send queued runs, oldest first; returns how many went through. A run the
 * service refuses (validation, rate limit) is dropped, one that still cannot
 * reach the network stays queued.
 */
export function flushQueuedRuns(): Promise<number> {
  flushing ??= (async () => {
    const queue = readStore(QUEUE_KEY, QueuedRunsSchema) ?? []
    let sent = 0
    const kept: QueuedRun[] = []
    for (const run of queue) {
      try {
        await sendRun(run)
        sent++
      } catch (err) {
        // `run` carries what already went through (its replay id), and its submission id.
        if (retryable(err)) kept.push(run)
      }
    }
    writeStore(QUEUE_KEY, kept.length ? kept : null)
    return sent
  })().finally(() => {
    flushing = null
  })
  return flushing
}

// ------------------------------------------------- cloud saves (Slice D)

/** Whether this browser already has an arcade player (it submitted a run or linked a device). */
export function hasArcadeSession(): boolean {
  return readStore(SESSION_KEY, ArcadeSessionSchema) !== null
}

/** The player's save in `slot`, or null when there is none yet. */
export async function pullSave(slot = 'campaign'): Promise<CloudSave | null> {
  const session = await arcadeSession()
  const params = new URLSearchParams({ select: 'slot,schema_version,data,updated_at', slot: `eq.${slot}` })
  const rows = await request(`/rest/v1/saves?${params}`, v.array(CloudSaveSchema), { token: session.access_token })
  return rows[0] ?? null
}

/** Write the player's save in `slot`; resolves with the stored `updated_at`. */
export async function pushSave(schemaVersion: number, data: object, slot = 'campaign'): Promise<string> {
  const res = await callFunction('put-save', PutSaveResponse, JSON.stringify({ slot, schema_version: schemaVersion, data }))
  return res.updated_at
}

/** A one-time code (10 minutes) another device enters to share this player's saves. */
export async function createLinkCode(): Promise<{ code: string; expires_at: string }> {
  const session = await arcadeSession()
  const rows = await request('/rest/v1/rpc/create_device_link', v.array(LinkCodeSchema), { method: 'POST', body: '{}', token: session.access_token })
  if (!rows[0]) throw new ArcadeError('no link code returned', 502)
  return rows[0]
}

/** Link this device to the player behind `code`; false for an unknown, used or expired code. */
export async function redeemLinkCode(code: string): Promise<boolean> {
  const session = await arcadeSession()
  const player = await send('/rest/v1/rpc/redeem_device_link', {
    method: 'POST',
    body: JSON.stringify({ p_code: code }),
    token: session.access_token,
  })
  return typeof player === 'string'
}

// ------------------------------------------------- challenges v2 (Slice D)

const CHALLENGE_COLUMNS = 'id,kind,seed,map_id,target_score,challenger_name,replay_id,cascade_seed,board,title,starts_at,expires_at'

export async function fetchChallenge(id: string): Promise<ArcadeChallenge | null> {
  const params = new URLSearchParams({ select: CHALLENGE_COLUMNS, id: `eq.${id}` })
  const rows = await request(`/rest/v1/challenges?${params}`, v.array(ArcadeChallengeSchema))
  return rows[0] ?? null
}

/** This week's table of the week (created on first ask). */
export async function fetchWeeklyChallenge(): Promise<ArcadeChallenge | null> {
  const rows = await request('/rest/v1/rpc/current_weekly_challenge', v.array(ArcadeChallengeSchema), { method: 'POST', body: '{}' })
  return rows[0] ?? null
}

export async function fetchGhostTrack(replayId: string): Promise<GhostTrack | null> {
  const params = new URLSearchParams({ select: 'stride,samples,track', replay_id: `eq.${replayId}` })
  const rows = await request(`/rest/v1/ghost_tracks?${params}`, v.array(GhostTrackSchema))
  return rows[0] ?? null
}

/**
 * The ghost a challenge is raced against: the challenger's own run, or for a
 * weekly challenge the best verified run on its board. Null until the
 * verifier has confirmed such a run.
 */
export async function fetchChallengeGhost(challenge: ArcadeChallenge): Promise<GhostTrack | null> {
  if (challenge.kind === 'player') return challenge.replay_id ? fetchGhostTrack(challenge.replay_id) : null
  if (!challenge.board) return null
  const params = new URLSearchParams({
    select: 'replay_id',
    map_id: `eq.${challenge.board}`,
    adventure_level: 'is.null',
    verified: 'is.true',
    order: 'rank.asc',
    limit: '1',
  })
  const rows = await request(`/rest/v1/leaderboard?${params}`, v.array(LeaderboardReplayIdSchema))
  const replayId = rows[0]?.replay_id
  return replayId ? fetchGhostTrack(replayId) : null
}

// ------------------------------------- weekly tournaments (#490 Slice C)

const TOURNAMENT_COLUMNS = 'challenge_id,board,title,seed,cascade_seed,map_id,starts_at,expires_at,frozen_at,status,entries,leader_name,leader_score'
const STANDING_COLUMNS = 'challenge_id,board,rank,name,score,replay_id,played_at,final,mine,has_ghost'

/** This week's tournament and the archive, newest first. */
export async function fetchTournaments(limit = 10): Promise<Tournament[]> {
  const params = new URLSearchParams({ select: TOURNAMENT_COLUMNS, order: 'starts_at.desc', limit: String(limit) })
  return request(`/rest/v1/tournaments?${params}`, v.array(TournamentSchema))
}

/** The top `limit` of a tournament board: verified runs only, one per player. */
export async function fetchTournamentStandings(board: string, limit = 10): Promise<TournamentStanding[]> {
  const params = new URLSearchParams({ select: STANDING_COLUMNS, board: `eq.${board}`, order: 'rank.asc', limit: String(limit) })
  return request(`/rest/v1/tournament_standings?${params}`, v.array(TournamentStandingSchema))
}

/**
 * This player's own row on a tournament board, or null when they have no
 * verified run there (or no arcade player in this browser yet — reading
 * never creates one).
 */
export async function fetchMyTournamentStanding(board: string): Promise<TournamentStanding | null> {
  if (!hasArcadeSession()) return null
  const session = await arcadeSession()
  const params = new URLSearchParams({ select: STANDING_COLUMNS, board: `eq.${board}`, mine: 'is.true', limit: '1' })
  const rows = await request(`/rest/v1/tournament_standings?${params}`, v.array(TournamentStandingSchema), { token: session.access_token })
  return rows[0] ?? null
}

/** The top `limit` (1–5) verified runs on a tournament board with their ghosts, best first. */
export async function fetchTournamentGhosts(board: string, limit = 3): Promise<TournamentGhost[]> {
  return request('/rest/v1/rpc/tournament_ghosts', v.array(TournamentGhostSchema), {
    method: 'POST',
    body: JSON.stringify({ p_board: board, p_limit: limit }),
  })
}

// ------------------------------------------------- live spectate (Slice E)

/** Open a live run; resolves with its id. Ends the player's previous live run. */
export async function startLiveRun(run: {
  header: object
  mapId: string
  tag: string | null
  chunkSteps: number
  trackStride: number
}): Promise<string> {
  const session = await arcadeSession()
  const id = await send('/rest/v1/rpc/live_start', {
    method: 'POST',
    body: JSON.stringify({
      p_header: run.header,
      p_map_id: run.mapId,
      p_tag: run.tag,
      p_chunk_steps: run.chunkSteps,
      p_track_stride: run.trackStride,
    }),
    token: session.access_token,
  })
  if (typeof id !== 'string') throw new ArcadeError('no live run id returned', 502)
  return id
}

/** Append the next chunk (`seq` in order; resending the last one is harmless). Resolves with the frames streamed so far. */
export async function appendLiveChunk(liveId: string, chunk: LiveChunk): Promise<number> {
  const session = await arcadeSession()
  return request('/rest/v1/rpc/live_append', v.number(), {
    method: 'POST',
    body: JSON.stringify({
      p_live_id: liveId,
      p_seq: chunk.seq,
      p_frames: chunk.frames,
      p_frame_count: chunk.frame_count,
      p_state_hash: chunk.state_hash,
      p_score: chunk.score,
      p_track: chunk.track,
      p_final: chunk.final,
    }),
    token: session.access_token,
  })
}

const LIVE_RUN_COLUMNS = 'id,map_id,player_tag,chunk_steps,track_stride,chunks,frames,score,status,created_at,updated_at'

/** Runs streaming right now, most recently updated first. */
export async function fetchLiveRuns(limit = 20): Promise<LiveRun[]> {
  const params = new URLSearchParams({ select: LIVE_RUN_COLUMNS, order: 'updated_at.desc', limit: String(limit) })
  return request(`/rest/v1/live_now?${params}`, v.array(LiveRunSchema))
}

/** A live (or finished) run with its header, or null when there is none. */
export async function fetchLiveRun(id: string): Promise<LiveRun | null> {
  const params = new URLSearchParams({ select: `${LIVE_RUN_COLUMNS},header`, id: `eq.${id}` })
  const rows = await request(`/rest/v1/replays_live?${params}`, v.array(LiveRunSchema))
  return rows[0] ?? null
}

/** The run's chunks from `fromSeq` on, in order. */
export async function fetchLiveChunks(id: string, fromSeq: number, limit = 120): Promise<LiveChunk[]> {
  const params = new URLSearchParams({
    select: 'seq,start_frame,frame_count,frames,state_hash,score,track,final',
    live_id: `eq.${id}`,
    seq: `gte.${fromSeq}`,
    order: 'seq.asc',
    limit: String(limit),
  })
  return request(`/rest/v1/replays_live_chunks?${params}`, v.array(LiveChunkSchema))
}
