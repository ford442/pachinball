/**
 * A replay tape as stored or uploaded (`ReplayRecorder.fromJSON`'s input), as
 * a Valibot schema (#505 §A). Every field is lenient: tapes from every schema
 * version (camelCase or the older snake_case keys) parse, and a field with the
 * wrong type reads as absent, so it takes the same default a missing one
 * always has. `fromJSON` then normalises the result into a `ReplayPayload`.
 *
 * A tape's numbers are never rewritten here: what parses is what plays.
 */

import * as v from 'valibot'
import { lenient } from './record-kit'

const str = () => v.string()
const nullableStr = () => v.nullable(v.string())
const finite = () => v.pipe(v.number(), v.finite())

const Nudge = v.object({ x: finite(), y: finite(), z: finite() })

/** One input row of an uncompressed tape (`InputFrame`, older tapes included). */
export const StoredInputFrameSchema = v.object({
  flipperLeft: v.fallback(v.nullable(v.boolean()), null),
  flipperRight: v.fallback(v.nullable(v.boolean()), null),
  plungerCharge: lenient(v.nullable(finite())),
  plunger: v.fallback(v.boolean(), false),
  nudge: v.fallback(v.nullable(Nudge), null),
  nudgeSource: lenient(v.picklist(['keyboard', 'orientation', 'touch'])),
  timestamp: v.fallback(finite(), 0),
})

export const StoredReplaySchema = v.object({
  version: lenient(v.number()),
  buildId: lenient(str()),
  build_id: lenient(str()),
  wasmSha256: lenient(str()),
  wasm_sha256: lenient(str()),
  mapId: lenient(str()),
  map_id: lenient(str()),
  seed: lenient(v.number()),
  physicsEngine: lenient(str()),
  renderer: lenient(v.picklist(['webgl2', 'webgpu'])),
  client_renderer: lenient(v.picklist(['webgl2', 'webgpu'])),
  createdAt: lenient(str()),
  machine: lenient(str()),
  frames: lenient(v.array(StoredInputFrameSchema)),
  compressedFrames: lenient(str()),
  compressed_frames: lenient(str()),
  finalScore: lenient(v.number()),
  final_score: lenient(v.number()),
  targetScore: lenient(v.number()),
  target_score: lenient(v.number()),
  replayId: lenient(str()),
  replay_id: lenient(str()),
  challengeId: lenient(str()),
  challenge_id: lenient(str()),
  snapshotVersion: lenient(v.number()),
  snapshot_version: lenient(v.number()),
  // `null` is meaningful for these two ("hashed, none"): only a wrong type reads as absent.
  staticHash: lenient(nullableStr()),
  static_hash: lenient(nullableStr()),
  pinFieldOccupancy: lenient(nullableStr()),
  pin_field_occupancy: lenient(nullableStr()),
  feederTunablesHash: lenient(str()),
  feeder_tunables_hash: lenient(str()),
  initialSnapshot: lenient(str()),
  initial_snapshot: lenient(str()),
  cascade: lenient(
    v.object({ mode: v.picklist(['daily', 'free']), seed: v.number(), seedId: str() }),
  ),
})

export type StoredReplay = v.InferOutput<typeof StoredReplaySchema>
