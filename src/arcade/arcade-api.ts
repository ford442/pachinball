/**
 * Live arcade service client (#444 Slice B) — Supabase: PostgREST reads,
 * one Edge Function per write path, Supabase Auth anonymous sessions.
 * The contract is docs/API_CONTRACT.md + docs/api/arcade.openapi.yaml, and
 * tests/arcade-contract.test.ts holds every request this module makes to it.
 *
 * Loaded lazily (leaderboard overlay, game over, spectate): nothing here is
 * on the boot path. storage.noahcohn.com stays the asset CDN (`ASSET_BASE`).
 */

import { ARCADE_KEY, ARCADE_URL, arcadeEnabled } from '../config/arcade'

export interface LeaderboardEntry {
  rank: number
  name: string
  score: number
  map_id: string
  adventure_level?: string | null
  balls: number
  combo_max: number
  date: string
  replay_id?: string | null
  challenge_id?: string | null
  /** Replayed and confirmed by the verifier (Slice C). */
  verified?: boolean
}

export interface ScoreSubmission {
  name: string
  score: number
  map_id: string
  adventure_level?: string
  balls: number
  combo_max: number
  replay_id?: string
  challenge_id?: string
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

interface ArcadeSession {
  access_token: string
  refresh_token: string
  /** Seconds since the epoch. */
  expires_at: number
  user_id: string
}

function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
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

async function send(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  // Not "offline": a disabled build must not queue runs it will never send.
  if (!arcadeEnabled()) throw new ArcadeError('arcade service disabled in this build', 503)
  const { token, headers, ...rest } = init
  let res: Response
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
  } catch (err) {
    throw new ArcadeError(err instanceof Error ? err.message : String(err), 0, true)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    // PostgREST and the functions say `message`, Supabase Auth says `msg`.
    const said = body && typeof body === 'object' ? (body as { message?: unknown; msg?: unknown }) : {}
    const message = typeof said.message === 'string' ? said.message : typeof said.msg === 'string' ? said.msg : res.statusText
    throw new ArcadeError(message, res.status)
  }
  return body
}

function toSession(body: unknown): ArcadeSession {
  const b = body as { access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number; user?: { id?: string } }
  if (!b?.access_token || !b.refresh_token || !b.user?.id) throw new ArcadeError('auth answered without a session', 502)
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
    const stored = readStore<ArcadeSession>(SESSION_KEY)
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
  return (await send(`/rest/v1/leaderboard?${params}`)) as LeaderboardEntry[]
}

/** Where `score` would place on the board (1 = top). */
export async function fetchPlayerRank(mapId: string, score: number, adventureLevel?: string): Promise<number> {
  return (await send('/rest/v1/rpc/player_rank', {
    method: 'POST',
    body: JSON.stringify({ p_map_id: mapId, p_score: score, p_adventure_level: adventureLevel ?? null }),
  })) as number
}

/** A stored replay's payload (what `ReplayRecorder.fromJSON` reads), or null when there is none. */
export async function fetchReplay(replayId: string): Promise<object | null> {
  const params = new URLSearchParams({ select: 'payload', id: `eq.${replayId}` })
  const rows = (await send(`/rest/v1/replays?${params}`)) as Array<{ payload: object }>
  return rows[0]?.payload ?? null
}

// ------------------------------------------------------------------- writes

async function callFunction(name: string, body: string): Promise<Record<string, unknown>> {
  const session = await arcadeSession()
  return (await send(`/functions/v1/${name}`, { method: 'POST', body, token: session.access_token })) as Record<string, unknown>
}

/** Upload a replay (`ReplayRecorder.toJSON`), returning its id. */
export async function submitReplay(replayJson: string): Promise<string> {
  const res = await callFunction('submit-replay', replayJson)
  return String(res.replay_id)
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
  const res = await callFunction('create-challenge', JSON.stringify(challenge))
  return String(res.challenge_id)
}

interface QueuedRun {
  score: ScoreSubmission
  replay?: string
  queuedAt: string
}

async function sendRun(run: QueuedRun): Promise<SubmitResult> {
  const score = { ...run.score }
  if (run.replay && !score.replay_id) score.replay_id = await submitReplay(run.replay)
  const res = await callFunction('submit-score', JSON.stringify(score))
  return { success: true, rank: Number(res.rank), score_id: Number(res.score_id), replay_id: score.replay_id }
}

function queueRun(run: QueuedRun): void {
  const queue = readStore<QueuedRun[]>(QUEUE_KEY) ?? []
  queue.push(run)
  writeStore(QUEUE_KEY, queue.slice(-MAX_QUEUED_RUNS))
}

/**
 * Submit a finished run: the replay first (when there is one), then the
 * score citing it. Without a network the run is queued on this device and
 * `flushQueuedRuns` sends it later.
 */
export async function submitRun(score: ScoreSubmission, replayJson?: string): Promise<SubmitResult> {
  const run: QueuedRun = { score, replay: replayJson, queuedAt: new Date().toISOString() }
  try {
    return await sendRun(run)
  } catch (err) {
    if (err instanceof ArcadeError && err.offline) {
      queueRun(run)
      return { success: false, queued: true, message: 'Offline: your score will be sent when you reconnect' }
    }
    return { success: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Runs waiting for the network. */
export function queuedRunCount(): number {
  return readStore<QueuedRun[]>(QUEUE_KEY)?.length ?? 0
}

let flushing: Promise<number> | null = null

/**
 * Send queued runs, oldest first; returns how many went through. A run the
 * service refuses (validation, rate limit) is dropped, one that still cannot
 * reach the network stays queued.
 */
export function flushQueuedRuns(): Promise<number> {
  flushing ??= (async () => {
    const queue = readStore<QueuedRun[]>(QUEUE_KEY) ?? []
    let sent = 0
    const kept: QueuedRun[] = []
    for (const run of queue) {
      try {
        await sendRun(run)
        sent++
      } catch (err) {
        if (err instanceof ArcadeError && (err.offline || err.status === 429)) kept.push(run)
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

export interface CloudSave {
  slot: string
  schema_version: number
  data: unknown
  updated_at: string
}

/** Whether this browser already has an arcade player (it submitted a run or linked a device). */
export function hasArcadeSession(): boolean {
  return readStore<ArcadeSession>(SESSION_KEY) !== null
}

/** The player's save in `slot`, or null when there is none yet. */
export async function pullSave(slot = 'campaign'): Promise<CloudSave | null> {
  const session = await arcadeSession()
  const params = new URLSearchParams({ select: 'slot,schema_version,data,updated_at', slot: `eq.${slot}` })
  const rows = (await send(`/rest/v1/saves?${params}`, { token: session.access_token })) as CloudSave[]
  return rows[0] ?? null
}

/** Write the player's save in `slot`; resolves with the stored `updated_at`. */
export async function pushSave(schemaVersion: number, data: object, slot = 'campaign'): Promise<string> {
  const res = await callFunction('put-save', JSON.stringify({ slot, schema_version: schemaVersion, data }))
  return String(res.updated_at)
}

/** A one-time code (10 minutes) another device enters to share this player's saves. */
export async function createLinkCode(): Promise<{ code: string; expires_at: string }> {
  const session = await arcadeSession()
  const rows = (await send('/rest/v1/rpc/create_device_link', { method: 'POST', body: '{}', token: session.access_token })) as Array<{
    code: string
    expires_at: string
  }>
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

export interface ArcadeChallenge {
  id: string
  kind: 'player' | 'weekly'
  seed: number
  map_id: string
  target_score: number
  challenger_name: string | null
  replay_id: string | null
  cascade_seed: number | null
  /** The board its runs submit to (weekly); null for a player's challenge. */
  board: string | null
  title: string | null
  starts_at: string
  expires_at: string | null
}

/** The verifier's recording of a verified run's ball: the race ghost. */
export interface GhostTrack {
  stride: number
  samples: number
  /** Base64 little-endian Int32 millimetre triples. */
  track: string
}

const CHALLENGE_COLUMNS = 'id,kind,seed,map_id,target_score,challenger_name,replay_id,cascade_seed,board,title,starts_at,expires_at'

export async function fetchChallenge(id: string): Promise<ArcadeChallenge | null> {
  const params = new URLSearchParams({ select: CHALLENGE_COLUMNS, id: `eq.${id}` })
  const rows = (await send(`/rest/v1/challenges?${params}`)) as ArcadeChallenge[]
  return rows[0] ?? null
}

/** This week's table of the week (created on first ask). */
export async function fetchWeeklyChallenge(): Promise<ArcadeChallenge | null> {
  const rows = (await send('/rest/v1/rpc/current_weekly_challenge', { method: 'POST', body: '{}' })) as ArcadeChallenge[]
  return rows[0] ?? null
}

export async function fetchGhostTrack(replayId: string): Promise<GhostTrack | null> {
  const params = new URLSearchParams({ select: 'stride,samples,track', replay_id: `eq.${replayId}` })
  const rows = (await send(`/rest/v1/ghost_tracks?${params}`)) as GhostTrack[]
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
  const rows = (await send(`/rest/v1/leaderboard?${params}`)) as Array<{ replay_id: string | null }>
  const replayId = rows[0]?.replay_id
  return replayId ? fetchGhostTrack(replayId) : null
}
