/**
 * POST /functions/v1/submit-score — a leaderboard entry (#444 Slice B).
 * Stored unverified; the verifier (Slice C) replays `replay_id` and flips it.
 * `rules_hash` names the rules the run was played under (#556): the board is
 * (map_id, rules_hash), the database refuses a hash other than the cited
 * replay's, and an older client that sends none is on the legacy vanilla board.
 * `ranked: false` (a run that hit a sim fault, #503 A3) is stored but never
 * verified or shown. An `Idempotency-Key` makes a retried call return the first
 * answer instead of storing the score again (#503 A4).
 */
import { asObject, BadRequest, idempotent, intField, MAP_ID, optionalText, readJson, rest, RULES_HASH, serve, TAG, textField, UUID } from '../_shared/arcade.ts'

serve(async (req) => {
  const body = asObject(await readJson(req, 4096))
  if (body.ranked !== undefined && typeof body.ranked !== 'boolean') throw new BadRequest('ranked must be a boolean')
  const row = {
    name: textField(body, 'name', TAG),
    map_id: textField(body, 'map_id', MAP_ID),
    adventure_level: optionalText(body, 'adventure_level', MAP_ID),
    score: intField(body, 'score', 0, 1_000_000_000_000),
    balls: intField(body, 'balls', 0, 99, 1),
    combo_max: intField(body, 'combo_max', 0, 1_000_000, 0),
    replay_id: optionalText(body, 'replay_id', UUID),
    challenge_id: optionalText(body, 'challenge_id', UUID),
    ranked: body.ranked !== false,
  }
  const rulesHash = optionalText(body, 'rules_hash', RULES_HASH)
  return idempotent(req, 'score', async () => {
    const [inserted] = await rest<Array<{ id: number }>>(req, 'scores?select=id', {
      method: 'POST',
      body: rulesHash ? { ...row, rules_hash: rulesHash } : row,
      prefer: 'return=representation',
    })
    const rank = await rest<number>(req, 'rpc/player_rank', {
      method: 'POST',
      body: {
        p_map_id: row.map_id,
        p_score: row.score,
        p_adventure_level: row.adventure_level,
        ...(rulesHash ? { p_rules_hash: rulesHash } : {}),
      },
    })
    return { status: 201, body: { success: true, score_id: inserted?.id ?? null, rank, verified: false } }
  })
})
