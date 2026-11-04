/**
 * POST /functions/v1/submit-replay — store a replay tape (#444 Slice B).
 * Body: ReplayRecorder.toJSON(payload). The database derives seed, map,
 * fingerprint and frame count from it and enforces the caps.
 */
import { asObject, BadRequest, json, readJson, rest, serve } from '../_shared/arcade.ts'

/** MAX_PAYLOAD_SIZE_BYTES: the replay cap the client and the replays table share. */
const MAX_PAYLOAD_SIZE_BYTES = 512 * 1024

serve(async (req) => {
  const payload = asObject(await readJson(req, MAX_PAYLOAD_SIZE_BYTES))
  if (!Number.isInteger(payload.version) || !Number.isInteger(payload.seed)) {
    throw new BadRequest('payload needs integer version and seed')
  }
  if (typeof payload.compressedFrames !== 'string' && !Array.isArray(payload.frames)) {
    throw new BadRequest('payload needs compressedFrames or frames')
  }
  const [row] = await rest<Array<{ id: string; frame_count: number }>>(req, 'replays?select=id,frame_count', {
    method: 'POST',
    body: { payload },
    prefer: 'return=representation',
  })
  return json({ success: true, replay_id: row?.id ?? null, frame_count: row?.frame_count ?? 0 }, 201)
})
