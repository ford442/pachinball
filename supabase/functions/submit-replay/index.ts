/**
 * POST /functions/v1/submit-replay — store a replay tape (#444 Slice B).
 * Body: ReplayRecorder.toJSON(payload). The database derives seed, map,
 * fingerprint, frame count and the rules hash from it and enforces the caps.
 * A schema 4 tape names the rules it was played under (`rulesHash`, #556);
 * the answer echoes the hash stored, the one its score must name. An
 * `Idempotency-Key` makes a retried upload return the first replay id instead
 * of storing the tape again (#503 A4).
 */
import { asObject, BadRequest, idempotent, readJson, rest, RULES_HASH, serve } from '../_shared/arcade.ts'

/** The first replay schema whose tapes name their rules (src/replay/replay-recorder.ts). */
const REPLAY_RULES_SCHEMA = 4

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
  const rulesHash = payload.rulesHash
  if (rulesHash !== undefined && (typeof rulesHash !== 'string' || !RULES_HASH.test(rulesHash))) {
    throw new BadRequest('rulesHash must be 64 lower-case hex characters')
  }
  if (rulesHash === undefined && Number(payload.version) >= REPLAY_RULES_SCHEMA) {
    throw new BadRequest(`a schema ${String(payload.version)} payload names its rules (rulesHash)`)
  }
  return idempotent(req, 'replay', async () => {
    const [row] = await rest<Array<{ id: string; frame_count: number; rules_hash: string }>>(req, 'replays?select=id,frame_count,rules_hash', {
      method: 'POST',
      body: { payload },
      prefer: 'return=representation',
    })
    return {
      status: 201,
      body: { success: true, replay_id: row?.id ?? null, frame_count: row?.frame_count ?? 0, rules_hash: row?.rules_hash ?? null },
    }
  })
})
