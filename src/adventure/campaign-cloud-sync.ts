/**
 * Campaign cloud save (#444 Slice D): the versioned campaign save
 * (`adventure-campaign-persistence.ts`) synced to the arcade service's
 * `saves` table, plus a file export / import for players who stay offline.
 *
 * On start (when this browser already has an arcade player) the cloud copy is
 * pulled, run through the same migration as the local one, and merged so no
 * progress is lost; every local save (each campaign checkpoint) is pushed
 * after a short debounce, and again when the network comes back. Linking a
 * device (a one-time code) makes two browsers share one save.
 *
 * Loaded lazily: nothing here is on the boot path.
 */

import type { SerializableProgressionState } from './adventure-track-progression'
import {
  CAMPAIGN_STORAGE_VERSION,
  migrateCampaignStorage,
  serializeCampaignStorage,
  type CampaignPersistencePayload,
} from './adventure-campaign-persistence'
import type { CampaignRewardsManager } from './campaign-rewards-manager'
import { createTimerScope } from '../core/timers'

/** The cloud slot the campaign lives in. */
export const CAMPAIGN_SAVE_SLOT = 'campaign'
const PUSH_DEBOUNCE_MS = 1500

const union = (a: readonly string[], b: readonly string[]) => [...a, ...b.filter((x) => !a.includes(x))]

/**
 * Merge two saves without losing progress: every completed / unlocked track
 * and reward from either, the best score per track, the larger totals. The
 * current track and equipped cosmetics come from the save that got further
 * (more completed tracks; `a` on a tie). merge(a, a) is a.
 */
export function mergeCampaignPayloads(a: CampaignPersistencePayload, b: CampaignPersistencePayload): CampaignPersistencePayload {
  const pa = a.progression
  const pb = b.progression
  const further = pb.completedTracks.length > pa.completedTracks.length ? b : a
  const bestScores: Record<string, number> = { ...pa.bestScores }
  for (const [track, score] of Object.entries(pb.bestScores)) {
    bestScores[track] = Math.max(bestScores[track] ?? 0, score)
  }
  const progression: SerializableProgressionState = {
    completedTracks: union(pa.completedTracks, pb.completedTracks),
    unlockedTracks: union(pa.unlockedTracks, pb.unlockedTracks),
    bestScores,
    currentTrack: further.progression.currentTrack,
    totalGoldBallsCollected: Math.max(pa.totalGoldBallsCollected, pb.totalGoldBallsCollected),
    totalRewardsEarned: Math.max(pa.totalRewardsEarned, pb.totalRewardsEarned),
  }
  return {
    version: CAMPAIGN_STORAGE_VERSION,
    progression,
    unlockedRewardIds: union(a.unlockedRewardIds ?? [], b.unlockedRewardIds ?? []),
    equippedRewards: { ...(further.equippedRewards ?? {}) },
  }
}

/** The export file: exactly the stored save, so export → import → export is byte-identical. */
export function exportCampaignSave(manager: CampaignRewardsManager): string {
  return serializeCampaignStorage(manager.getStoragePayload())
}

/** Adopt an exported file (any older schema migrates); false when it is not a campaign save. */
export function importCampaignSave(manager: CampaignRewardsManager, text: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || !('progression' in parsed || 'completedTracks' in parsed)) return false
  return manager.applyExternalPayload(parsed)
}

type ArcadeApi = typeof import('../arcade/arcade-api')

export type CloudSyncStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error'

export class CampaignCloudSync {
  private status: CloudSyncStatus = 'off'
  private readonly timers = createTimerScope()
  private pushTimer: number | null = null
  private pending = false
  private applying = false
  private readonly listeners = new AbortController()
  onStatus: ((status: CloudSyncStatus) => void) | null = null

  constructor(
    private readonly manager: CampaignRewardsManager,
    private readonly arcade: ArcadeApi,
  ) {
    manager.onPersist = () => {
      if (!this.applying && this.status !== 'off') this.schedulePush()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { if (this.pending) this.schedulePush() }, { signal: this.listeners.signal })
    }
  }

  getStatus(): CloudSyncStatus {
    return this.status
  }

  private setStatus(status: CloudSyncStatus): void {
    this.status = status
    this.onStatus?.(status)
  }

  /** Start syncing when this browser has an arcade player (or `force`: it is about to get one). */
  async start(force = false): Promise<void> {
    if (!force && !this.arcade.hasArcadeSession()) return
    await this.pullAndMerge()
  }

  /** Pull the cloud save, migrate and merge it into the local one, and push the result if it moved. */
  async pullAndMerge(): Promise<void> {
    this.setStatus('syncing')
    try {
      const remote = await this.arcade.pullSave(CAMPAIGN_SAVE_SLOT)
      const local = this.manager.getStoragePayload()
      const remoteSave = remote ? migrateCampaignStorage(remote.data) : null
      const merged = remoteSave ? mergeCampaignPayloads(local, remoteSave) : local
      if (serializeCampaignStorage(merged) !== serializeCampaignStorage(local)) {
        this.applying = true
        try {
          this.manager.applyExternalPayload(merged)
        } finally {
          this.applying = false
        }
      }
      const upToDate = remoteSave
        && remote?.schema_version === CAMPAIGN_STORAGE_VERSION
        && serializeCampaignStorage(remoteSave) === serializeCampaignStorage(merged)
      if (!upToDate) await this.push()
      else this.setStatus('synced')
    } catch (err) {
      this.fail(err)
    }
  }

  private schedulePush(): void {
    this.pending = true
    if (this.pushTimer !== null) this.timers.clearTimeout(this.pushTimer)
    this.pushTimer = this.timers.setTimeout(() => {
      this.pushTimer = null
      void this.push()
    }, PUSH_DEBOUNCE_MS)
  }

  private async push(): Promise<void> {
    this.pending = true
    this.setStatus('syncing')
    try {
      const payload = this.manager.getStoragePayload()
      await this.arcade.pushSave(CAMPAIGN_STORAGE_VERSION, JSON.parse(serializeCampaignStorage(payload)) as object, CAMPAIGN_SAVE_SLOT)
      this.pending = false
      this.setStatus('synced')
    } catch (err) {
      this.fail(err)
    }
  }

  private fail(err: unknown): void {
    const offline = err instanceof this.arcade.ArcadeError && err.offline
    this.setStatus(offline ? 'offline' : 'error')
  }

  /** Link this device to another player's saves with their code, then adopt (merge) that save. */
  async linkDevice(code: string): Promise<boolean> {
    const linked = await this.arcade.redeemLinkCode(code)
    if (linked) await this.pullAndMerge()
    return linked
  }

  dispose(): void {
    this.timers.dispose()
    this.listeners.abort()
    if (this.manager.onPersist) this.manager.onPersist = null
  }
}
