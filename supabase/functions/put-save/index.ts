/**
 * POST /functions/v1/put-save — upsert the caller's save slot (#444 Slice B;
 * the campaign sync in Slice D writes through here).
 */
import { asObject, intField, json, readJson, rest, serve, textField } from '../_shared/arcade.ts'

const MAX_SAVE_BYTES = 64 * 1024

serve(async (req) => {
  const body = asObject(await readJson(req, MAX_SAVE_BYTES + 1024))
  const row = {
    slot: body.slot === undefined ? 'campaign' : textField(body, 'slot', /^[a-z0-9-]{1,32}$/),
    schema_version: intField(body, 'schema_version', 1, 1_000_000),
    data: asObject(body.data),
  }
  const [saved] = await rest<Array<{ slot: string; schema_version: number; updated_at: string }>>(
    req,
    'saves?on_conflict=profile_id,slot&select=slot,schema_version,updated_at',
    { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' },
  )
  return json({ success: true, ...saved })
})
