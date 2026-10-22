/**
 * POST /functions/v1/submit-score — a leaderboard entry (#444 Slice B).
 * Stored unverified; the verifier (Slice C) replays `replay_id` and flips it.
 */
import { asObject, intField, MAP_ID, optionalText, readJson, rest, serve, TAG, textField, UUID, json } from '../_shared/arcade.ts'

serve(async (req) => {
  const body = asObject(await readJson(req, 4096))
  const row = {
    name: textField(body, 'name', TAG),
    map_id: textField(body, 'map_id', MAP_ID),
    adventure_level: optionalText(body, 'adventure_level', MAP_ID),
    score: intField(body, 'score', 0, 1_000_000_000_000),
    balls: intField(body, 'balls', 0, 99, 1),
    combo_max: intField(body, 'combo_max', 0, 1_000_000, 0),
    replay_id: optionalText(body, 'replay_id', UUID),
    challenge_id: optionalText(body, 'challenge_id', UUID),
  }
  const [inserted] = await rest<Array<{ id: number }>>(req, 'scores?select=id', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  })
  const rank = await rest<number>(req, 'rpc/player_rank', {
    method: 'POST',
    body: { p_map_id: row.map_id, p_score: row.score, p_adventure_level: row.adventure_level },
  })
  return json({ success: true, score_id: inserted?.id ?? null, rank, verified: false }, 201)
})
