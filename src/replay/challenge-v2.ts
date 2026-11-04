/**
 * Challenges v2 (#444 Slice D): a challenge is a row on the arcade service —
 * seed, table, target and the challenger's run. Opening `?challenge=<id>`
 * loads it before the first game (`ChallengeSystem.whenReady`), plays on its
 * table, and races the challenger's verified ghost. The table of the week is
 * a weekly challenge row with its own board, raced against the best verified
 * run so far. Loaded lazily; nothing here is on the boot path.
 */

import type { Scene } from '@babylonjs/core/scene'
import * as arcade from '../arcade/arcade-api'
import type { ArcadeChallenge } from '../arcade/arcade-api'
import { getDailyCascadeState } from '../cascade/daily-cascade-state'
import { getChallengeSystem, type ChallengeConfig } from './challenge-system'
import { GhostRace } from './ghost-race'
import type { FinishedRun, HUDHost } from '../game/game-hud'

/** What the game provides (Game implements it). */
export interface ChallengeHost {
  readonly scene: Scene | null
  ghostRace: GhostRace | null
  readonly currentMapId?: string | null
  startGame(): Promise<void>
  switchTableMap(mapName: string): void
  showMessage(msg: string, duration: number): void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOAD_TIMEOUT_MS = 6000

function toConfig(row: ArcadeChallenge): ChallengeConfig {
  return {
    id: row.id,
    seed: row.seed >>> 0,
    targetScore: row.target_score,
    mapId: row.map_id,
    challengerName: row.challenger_name ?? undefined,
    kind: row.kind,
    board: row.board ?? undefined,
    cascadeSeed: row.cascade_seed ?? undefined,
    replayId: row.replay_id ?? undefined,
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/**
 * Make a challenge the active one: its session seed (startGame reads it), its
 * table (map and cascade seed, or the vanilla table) and its race ghost.
 * Resolves true when a verified ghost was found.
 */
export async function adoptChallenge(host: ChallengeHost, row: ArcadeChallenge): Promise<boolean> {
  getChallengeSystem().setActiveChallenge(toConfig(row))
  if (host.currentMapId !== row.map_id) host.switchTableMap(row.map_id)
  const cascade = getDailyCascadeState()
  if (row.cascade_seed !== null) cascade.setFreeSeed(row.cascade_seed)
  else cascade.setMode('vanilla')
  void import('../game/daily-cascade-ui').then((ui) => ui.refreshDailyCascadeUI())

  host.ghostRace?.dispose()
  host.ghostRace = null
  const ghost = await withTimeout(arcade.fetchChallengeGhost(row).catch(() => null), LOAD_TIMEOUT_MS)
  if (ghost && host.scene) host.ghostRace = new GhostRace(host.scene, ghost, row.challenger_name ?? row.title ?? 'ghost')
  return host.ghostRace !== null
}

/**
 * `?challenge=<uuid>`: load the challenge row before the first game starts.
 * The caller hands the promise to `ChallengeSystem.setResolving`.
 */
export async function resolveLinkedChallenge(host: ChallengeHost): Promise<void> {
  const id = getChallengeSystem().getActiveChallenge()?.id
  if (!id || !UUID.test(id)) return
  {
    const row = await withTimeout(arcade.fetchChallenge(id).catch(() => null), LOAD_TIMEOUT_MS)
    if (!row) {
      host.showMessage('Challenge not found (or offline): playing a free game', 3500)
      return
    }
    const racing = await adoptChallenge(host, row)
    const who = row.challenger_name ?? 'the challenger'
    host.showMessage(
      racing ? `Racing ${who}'s verified run — beat ${row.target_score.toLocaleString()}` : `Beat ${row.target_score.toLocaleString()} — ${who}'s run is still being verified`,
      4500,
    )
  }
}

/** Start screen: this week's table, raced against the best verified run so far. */
export async function playWeekly(host: ChallengeHost): Promise<void> {
  const row = await withTimeout(arcade.fetchWeeklyChallenge().catch(() => null), LOAD_TIMEOUT_MS)
  if (!row) {
    host.showMessage('Table of the week is unavailable (offline?)', 3000)
    return
  }
  const racing = await adoptChallenge(host, row)
  host.showMessage(racing ? `${row.title ?? 'Table of the week'} — racing the leader` : `${row.title ?? 'Table of the week'} — set the first verified score`, 4000)
  await host.startGame()
}

/**
 * "Challenge friends" after a submitted run: a challenge row citing the run's
 * replay; resolves with the link to share. Its ghost appears once the
 * verifier has confirmed the run.
 */
export async function createRunChallenge(run: {
  seed: number
  score: number
  mapId: string
  name: string
  replayId: string
  cascadeSeed?: number
}): Promise<string> {
  const id = await arcade.createChallenge({
    seed: run.seed,
    targetScore: run.score,
    mapId: run.mapId,
    challengerName: run.name,
    replayId: run.replayId,
    cascadeSeed: run.cascadeSeed,
  })
  return `${location.origin}${location.pathname}?challenge=${id}`
}

/**
 * "Challenge friends" on the game-over screen: a challenge citing the run's
 * replay, so friends play the same table against its verified ghost. The run
 * is submitted first when it is not on the board yet; offline (or with no
 * tape), the v1 `seed:target` link.
 */
export async function challengeFriends(
  run: FinishedRun | null,
  host: Pick<HUDHost, 'ensureOverlaySystems' | 'leaderboardSystem' | 'uiManager' | 'score'>,
  submitRun: (run: FinishedRun, rank: number | null) => Promise<void>,
): Promise<void> {
  let link: string | null = null
  if (run?.payload) {
    if (!run.replayId) {
      await host.ensureOverlaySystems()
      host.leaderboardSystem.setContext(run.board)
      await submitRun(run, await host.leaderboardSystem.checkRank(run.score))
    }
    if (run.replayId && run.name) {
      link = await createRunChallenge({
        seed: run.payload.seed,
        score: run.score,
        mapId: run.tableMapId,
        name: run.name,
        replayId: run.replayId,
        cascadeSeed: run.payload.cascade?.seed,
      }).catch(() => null)
    }
  }
  if (!link) {
    const seed = run?.payload?.seed ?? (await import('../core/seeded-rng')).getSessionSeed()
    const { ChallengeSystem } = await import('./challenge-system')
    link = ChallengeSystem.createChallengeShareUrl(seed, run?.score ?? host.score, run?.tableMapId ?? 'neon-helix')
  }
  try {
    await navigator.clipboard.writeText(link)
    host.uiManager?.showMessage('Challenge link copied to clipboard! Share with friends.', 3500)
  } catch {
    prompt('Copy challenge link:', link)
  }
}
