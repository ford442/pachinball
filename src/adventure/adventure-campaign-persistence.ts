/**
 * Adventure campaign persistence — versioned localStorage with schema migration.
 */

import * as v from 'valibot'
import type { SerializableProgressionState } from './adventure-track-progression'
import { StoredCampaignSchema, StoredProgressionSchema, type StoredProgression } from '../schemas/storage'
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
  raw: Partial<SerializableProgressionState> | StoredProgression | undefined,
): SerializableProgressionState {
  const validTrackIds = new Set(Object.keys(TRACK_CATALOG))
  const completedTracks = (raw?.completedTracks ?? []).filter((id) => validTrackIds.has(id))
  const unlockedTracks = (raw?.unlockedTracks ?? []).filter((id) => validTrackIds.has(id))
  const fallbackUnlocked = unlockedTracks.length > 0 ? unlockedTracks : ['NEON_HELIX']

  const bestScores: Record<string, number> = {}
  for (const [trackId, score] of Object.entries(raw?.bestScores ?? {})) {
    if (!validTrackIds.has(trackId)) continue
    if (typeof score !== 'number' || !Number.isFinite(score)) continue // a stored record's scores are unchecked
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

/** Read any stored / exported / cloud campaign record (every older schema migrates); null when it is not an object. */
export function migrateCampaignStorage(raw: unknown): CampaignPersistencePayload | null {
  const parsed = v.safeParse(StoredCampaignSchema, raw)
  if (!parsed.success) return null
  const record = parsed.output
  const version = record.version ?? 1

  if (version > CAMPAIGN_STORAGE_VERSION) {
    console.warn('[CampaignPersistence] Future schema version — applying best-effort sanitize')
  }

  // Version 1 kept the progression fields at the top level.
  const legacy = version === 1 && !record.progression ? v.safeParse(StoredProgressionSchema, raw) : null
  const progression = sanitizeProgressionState(record.progression ?? (legacy?.success ? legacy.output : undefined))

  return {
    version: CAMPAIGN_STORAGE_VERSION,
    progression,
    unlockedRewardIds: record.unlockedRewardIds ?? [],
    equippedRewards: record.equippedRewards ?? {},
  }
}

/** The stored record for `payload`, as a plain object (the cloud slot's `data`). */
export function campaignStorageRecord(payload: CampaignPersistencePayload): CampaignPersistencePayload {
  return {
    ...payload,
    version: CAMPAIGN_STORAGE_VERSION,
    progression: sanitizeProgressionState(payload.progression),
  }
}

export function serializeCampaignStorage(payload: CampaignPersistencePayload): string {
  return JSON.stringify(campaignStorageRecord(payload))
}