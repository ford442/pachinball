import { AdventureTrackType } from './adventure-types'
import { getManifestStartAnchor } from './manifests'

export function getTrackStartAnchor(track: AdventureTrackType): import('@babylonjs/core').Vector3 {
  return getManifestStartAnchor(track).clone()
}

export function isAdventureTrackType(value: string): value is AdventureTrackType {
  return Object.values(AdventureTrackType).includes(value as AdventureTrackType)
}
