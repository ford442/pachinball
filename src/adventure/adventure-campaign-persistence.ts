/**
 * Adventure campaign persistence — versioned localStorage with schema migration.
 */

import type { SerializableProgressionState } from './adventure-track-progression'
import { TRACK_CATALOG } from './adventure-track-progression'

export const CAMPAIGN_STORAGE_KEY = 'pachinball.campaign.rewards.v1'
export const CAMPAIGN_STORAGE_VERSION = 2

export interface CampaignPersistencePayload {
  version: number
  progression: SerializableProgressionState
  unlockedRewardIds?: string[]
  equippedRewards?: Record<string, string>
}

export function sanitizeProgressionState(
  raw: Partial<SerializableProgressionState> | undefined,
): SerializableProgressionState {
  const validTrackIds = new Set(Object.keys(TRACK_CATALOG))
  const completedTracks = (raw?.completedTracks ?? []).filter((id) => validTrackIds.has(id))
  const unlockedTracks = (raw?.unlockedTracks ?? []).filter((id) => validTrackIds.has(id))
  const fallbackUnlocked = unlockedTracks.length > 0 ? unlockedTracks : ['NEON_HELIX']

  const bestScores: Record<string, number> = {}
  for (const [trackId, score] of Object.entries(raw?.bestScores ?? {})) {
    if (!validTrackIds.has(trackId)) continue
    if (typeof score !== 'number' || !Number.isFinite(score)) continue
    const normalized = Math.max(0, Math.round(score))
    if (normalized <= 0) continue
    bestScores[trackId] = normalized
  }

  const currentTrack =
    raw?.currentTrack && validTrackIds.has(raw.currentTrack) ? raw.currentTrack : 'NEON_HELIX'

  return {
    completedTracks,
    unlockedTracks: fallbackUnlocked,
    bestScores,
    currentTrack: fallbackUnlocked.includes(currentTrack) ? currentTrack : 'NEON_HELIX',
    totalGoldBallsCollected: Math.max(0, Math.floor(raw?.totalGoldBallsCollected ?? 0)),
    totalRewardsEarned: Math.max(0, Math.floor(raw?.totalRewardsEarned ?? 0)),
  }
}

export function migrateCampaignStorage(raw: unknown): CampaignPersistencePayload | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const version = typeof record.version === 'number' ? record.version : 1

  if (version > CAMPAIGN_STORAGE_VERSION) {
    console.warn('[CampaignPersistence] Future schema version — applying best-effort sanitize')
  }

  const progression = sanitizeProgressionState(
    (record.progression as Partial<SerializableProgressionState> | undefined) ??
      (version === 1 ? (record as Partial<SerializableProgressionState>) : undefined),
  )

  const unlockedRewardIds = Array.isArray(record.unlockedRewardIds)
    ? record.unlockedRewardIds.filter((id): id is string => typeof id === 'string')
    : []

  const equippedRewards =
    record.equippedRewards && typeof record.equippedRewards === 'object'
      ? (record.equippedRewards as Record<string, string>)
      : {}

  return {
    version: CAMPAIGN_STORAGE_VERSION,
    progression,
    unlockedRewardIds,
    equippedRewards,
  }
}

export function serializeCampaignStorage(payload: CampaignPersistencePayload): string {
  return JSON.stringify({
    ...payload,
    version: CAMPAIGN_STORAGE_VERSION,
    progression: sanitizeProgressionState(payload.progression),
  })
}