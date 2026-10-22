/**
 * POST /functions/v1/create-challenge — a shareable seed + table + target,
 * citing the challenger's run (#444 Slices B, D).
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
    // The free-seed cascade table it is played on (#444 Slice D); null on the vanilla table.
    cascade_seed: body.cascadeSeed === undefined || body.cascadeSeed === null ? null : intField(body, 'cascadeSeed', 0, 4294967295),
  }
  const [inserted] = await rest<Array<{ id: string }>>(req, 'challenges?select=id', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  })
  return json({ success: true, challenge_id: inserted?.id ?? null }, 201)
})
