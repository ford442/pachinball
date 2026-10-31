/**
 * Campaign stage map model — pure data, no DOM, no Babylon.
 *
 * Lays TRACK_CATALOG out the way a player reads the campaign: the A/B spine
 * (`CAMPAIGN_MAIN_PATH`) plus every off-spine stage grouped into a branch that
 * hangs off the spine stage which unlocks it. Branches are derived from
 * `unlockedBy`, so a new catalogue entry shows up on the map without touching
 * this file.
 */

import {
  CAMPAIGN_MAIN_PATH,
  TRACK_CATALOG,
  type TrackInfo,
} from '../adventure-track-progression'

export type CampaignStageStatus = 'completed' | 'current' | 'unlocked' | 'locked'

/** The slice of AdventureTrackProgression the map reads. */
export interface CampaignProgressView {
  isTrackUnlocked(trackId: string): boolean
  isTrackCompleted(trackId: string): boolean
  getBestScore(trackId: string): number
  getCurrentTrack(): string
}

export interface CampaignMapStage {
  id: string
  name: string
  description: string
  /** 'A' = EXTENDED_MAP course, 'B' = STATIONARY_TABLE arena. */
  slot: 'A' | 'B'
  difficulty: TrackInfo['difficulty']
  status: CampaignStageStatus
  /** Whether the map lets the player start this stage (it is unlocked). */
  playable: boolean
  bestScore: number
  recommendedScore: number
  /** 1-based spine position; null for branch stages. */
  stageNumber: number | null
  unlockedBy: string | null
}

export interface CampaignMapBranch {
  /** Spine stage this branch hangs off; null for stages no spine stage unlocks. */
  anchorTrackId: string | null
  anchorStageNumber: number | null
  kind: 'optional' | 'post-finale' | 'detached'
  stages: CampaignMapStage[]
}

export interface CampaignMapModel {
  spine: CampaignMapStage[]
  branches: CampaignMapBranch[]
  currentTrackId: string
  completedCount: number
  totalCount: number
  completionPercent: number
}

function stageStatus(id: string, progress: CampaignProgressView): CampaignStageStatus {
  if (progress.isTrackCompleted(id)) return 'completed'
  if (!progress.isTrackUnlocked(id)) return 'locked'
  return progress.getCurrentTrack() === id ? 'current' : 'unlocked'
}

function toStage(
  info: TrackInfo,
  progress: CampaignProgressView,
  stageNumber: number | null,
): CampaignMapStage {
  const status = stageStatus(info.id, progress)
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    slot: info.modeType === 'EXTENDED_MAP' ? 'A' : 'B',
    difficulty: info.difficulty,
    status,
    // Same gate as AdventureTrackProgression.setCurrentTrack(), which a map click calls.
    playable: progress.isTrackUnlocked(info.id),
    bestScore: progress.getBestScore(info.id),
    recommendedScore: info.recommendedScore,
    stageNumber,
    unlockedBy: info.unlockedBy ?? null,
  }
}

export function buildCampaignMapModel(
  progress: CampaignProgressView,
  catalog: Readonly<Record<string, TrackInfo>> = TRACK_CATALOG,
  spineIds: readonly string[] = CAMPAIGN_MAIN_PATH,
): CampaignMapModel {
  const spineSet = new Set(spineIds)
  const spine: CampaignMapStage[] = []
  spineIds.forEach((id, index) => {
    const info = catalog[id]
    if (info) spine.push(toStage(info, progress, index + 1))
  })

  // Off-spine stages, keyed by the track that unlocks them, in catalogue order.
  const childrenOf = new Map<string, TrackInfo[]>()
  const offSpine = Object.values(catalog).filter((info) => !spineSet.has(info.id))
  for (const info of offSpine) {
    const parent = info.unlockedBy ?? ''
    const list = childrenOf.get(parent) ?? []
    list.push(info)
    childrenOf.set(parent, list)
  }

  const placed = new Set<string>()
  // Depth-first so a chain (TIDAL_NEXUS → SOLAR_FLARE → …) reads in unlock order.
  const collectChain = (root: TrackInfo): TrackInfo[] => {
    const chain: TrackInfo[] = []
    const stack = [root]
    while (stack.length > 0) {
      const info = stack.pop()!
      if (placed.has(info.id)) continue
      placed.add(info.id)
      chain.push(info)
      const children = childrenOf.get(info.id) ?? []
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
    }
    return chain
  }

  const lastSpineId = spineIds[spineIds.length - 1]
  const branches: CampaignMapBranch[] = []
  spineIds.forEach((anchorId, index) => {
    for (const root of childrenOf.get(anchorId) ?? []) {
      const chain = collectChain(root)
      if (chain.length === 0) continue
      branches.push({
        anchorTrackId: anchorId,
        anchorStageNumber: index + 1,
        kind: anchorId === lastSpineId ? 'post-finale' : 'optional',
        stages: chain.map((info) => toStage(info, progress, null)),
      })
    }
  })

  // Anything left is unlocked by nothing on the map (no `unlockedBy`, or a parent
  // outside the catalogue). Show it rather than silently dropping a stage.
  const detached = offSpine.filter((info) => !placed.has(info.id)).flatMap(collectChain)
  if (detached.length > 0) {
    branches.push({
      anchorTrackId: null,
      anchorStageNumber: null,
      kind: 'detached',
      stages: detached.map((info) => toStage(info, progress, null)),
    })
  }

  const allStages = [...spine, ...branches.flatMap((b) => b.stages)]
  const completedCount = allStages.filter((s) => s.status === 'completed').length
  const totalCount = allStages.length

  return {
    spine,
    branches,
    currentTrackId: progress.getCurrentTrack(),
    completedCount,
    totalCount,
    completionPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
  }
}
