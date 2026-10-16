/**
 * POST /functions/v1/create-challenge — a shareable seed + target (#444 Slice B).
 */
import { asObject, intField, json, MAP_ID, optionalText, readJson, rest, serve, TAG, textField, UUID } from '../_shared/arcade.ts'

serve(async (req) => {
  const body = asObject(await readJson(req, 2048))
  const row = {
    seed: intField(body, 'seed', 0, 4294967295),
    target_score: intField(body, 'targetScore', 0, 1_000_000_000_000),
    map_id: textField(body, 'mapId', MAP_ID),
    challenger_name: optionalText(body, 'challengerName', TAG),
    replay_id: optionalText(body, 'replayId', UUID),
  }
  const [inserted] = await rest<Array<{ id: string }>>(req, 'challenges?select=id', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  })
  return json({ success: true, challenge_id: inserted?.id ?? null }, 201)
})
