# Live arcade service — API contract

Leaderboard, replays, challenges and saves for Pachinball (#444 Slice B).
The machine-readable contract is [`docs/api/arcade.openapi.yaml`](api/arcade.openapi.yaml);
`tests/arcade-contract.test.ts` fails if the client (`src/arcade/arcade-api.ts`)
sends anything that does not match it. This page is the prose: who may do
what, and the rules the database enforces.

The service is plain REST over Postgres. Today it runs on Supabase project
`znsioiaydrtsziwavdat` (`https://znsioiaydrtsziwavdat.supabase.co`):

| Piece | Where |
|-------|-------|
| Schema, RLS, grants, triggers | `supabase/migrations/` |
| RLS / write-rule tests (pgTAP) | `supabase/tests/database/` — `supabase test db` |
| Write paths (one Edge Function each) | `supabase/functions/` |
| Replay verifier (storage host) | `services/replay-verifier/` — `npm run test:verifier` |
| Client | `src/arcade/arcade-api.ts`, endpoint in `src/config/arcade.ts` |

`storage.noahcohn.com` stays the asset CDN (`ASSET_BASE`) and serves `/maps`.
The legacy `AdventureState.syncToBackend` still posts to its
`/adventure/progress`; Slice D moves campaign saves to `put-save`.

## Players

Every player is a Supabase Auth **anonymous user**, created the first time the
client writes (`POST /auth/v1/signup` with an empty body) and kept in
`localStorage` (`pachinball:arcade-session`), refreshed with
`POST /auth/v1/token?grant_type=refresh_token`. A trigger gives each new auth
user a `profiles` row; `profiles.tag` is an optional three-letter tag.

The project must have **Allow anonymous sign-ins** enabled (Authentication →
Sign In / Providers). Without it, reads work and every write answers 422 at
sign-in.

Every request carries the publishable key in `apikey`. Writes also carry the
player's access token in `Authorization: Bearer …`.

## Reads (PostgREST, anyone)

| Request | Answer |
|---------|--------|
| `GET /rest/v1/leaderboard?select=…&map_id=eq.<map>&adventure_level=is.null\|eq.<level>&order=rank.asc&limit=<n>` | `LeaderboardEntry[]`, best first: verified runs, and runs still pending for less than 24 hours (rejected runs never). `rank` is per (map, adventure level) over those rows; ties go to the earlier score. `verified` / `verification` say whether the verifier has confirmed the run. |
| `POST /rest/v1/rpc/player_rank` `{ p_map_id, p_score, p_adventure_level }` | Where that score would place on that board (1 = top). |
| `GET /rest/v1/replays?select=payload&id=eq.<uuid>` | `[{ payload }]` — what `ReplayRecorder.fromJSON` reads. |

Scores, replays, challenges and profiles are public. Saves are not readable
by anyone but their owner.

## Writes (Edge Functions, signed-in players)

Each function validates its body, then writes through PostgREST **as the
caller**, so the database rules below apply exactly as they would to a direct
REST call. Errors are `{ success: false, message }` with the HTTP status:
400 validation, 401 not signed in, 403 not yours, 413 too large, 429 rate limit.

| Function | Body | Answer |
|----------|------|--------|
| `POST /functions/v1/submit-replay` | `ReplayRecorder.toJSON(payload)`, ≤ 512 KB | `201 { success, replay_id, frame_count }` |
| `POST /functions/v1/submit-score` | `{ name, score, map_id, adventure_level?, balls, combo_max, replay_id?, challenge_id? }` | `201 { success, score_id, rank, verified: false }` |
| `POST /functions/v1/create-challenge` | `{ seed, targetScore, mapId, challengerName?, replayId? }` | `201 { success, challenge_id }` |
| `POST /functions/v1/put-save` | `{ slot?, schema_version, data }` (data ≤ 64 KB) | `200 { success, slot, schema_version, updated_at }` |

The client submits a finished run as the replay first, then the score citing
its `replay_id` (`submitRun`). Offline, the run is queued on the device
(`pachinball:arcade-queue`, at most five) and sent on the next `online` event
or game over; a run the service refuses is dropped, a rate-limited one waits.

## Rules the database enforces

These hold for any client, through the functions or straight at PostgREST:

- **Ownership.** A player inserts only rows whose owner column is their own id
  (RLS `with check`), and the owner column is filled from the token, never
  from the body. Nobody updates or deletes a score, replay or challenge. A
  player updates only their own tag and their own saves.
- **Columns.** Inserts are granted column by column: a client cannot set
  `verified`, `verifier_*`, `profile_id` / `creator_id`, timestamps, or a
  replay's derived columns.
- **Replays.** `seed`, `map_id`, `physics_engine`, `snapshot_version`,
  `static_hash` (the table descriptor hash), `feeder_tunables_hash`,
  `final_score` and `frame_count` are derived from the payload by a trigger.
  Payload ≤ 512 KB; at most 216 000 frames (one hour of fixed steps).
- **Scores.** `name` is three letters A–Z; a score may only cite the
  submitter's own replay.
- **Rate limits.** Per player: 5 scores and 5 replays a minute, 200 of each a
  day, 20 challenges an hour (HTTP 429).
- **Verification.** `verified`, `verifier_version`, `verifier_score`,
  `verify_reason`, `verified_at` and the claim columns are written only by
  the verifier with a secret key (below).

## Verification (Slice C)

Every score starts **pending**. The replay verifier
(`services/replay-verifier`, Node + headless Chromium on the storage host)
claims pending scores with `POST /rest/v1/rpc/claim_score_verifications`
(`{ p_limit }` → the scores with their tapes, oldest first,
`FOR UPDATE SKIP LOCKED`; a claim older than 15 minutes is handed out again),
replays each tape in the production build — in-process C++ engine, one fixed
step per tape frame — and records the verdict with
`POST /rest/v1/rpc/record_score_verification`:

- **verified** — the tape replays to the submitted score. `verifier_score` is
  the replayed score, `verify_state_hash` the C++ `getStateHash()` at the end,
  `verifier_version` the build that replayed it. The board shows ✓.
- **rejected** — `verify_reason` says why (no replay, an engine that does not
  replay step-exactly, a tape from another board, an unrecognised table
  descriptor hash, a tape that does not run to its end, or a score the tape
  does not reproduce). Never on the default board.

A pending score shows on the board, without ✓, for 24 hours; after that only
a verdict brings it back. Both RPCs are executable by `service_role` only.

Only runs recorded on the in-process `wasm-owner` engine can verify — the
default since #444; `?physics=wasm-worker` and Rapier runs are rejected as
unverifiable.

## Changing the contract

1. Write a new migration in `supabase/migrations/` (the file name is the
   version the project records), apply it, and extend
   `supabase/tests/database/arcade_rls.test.sql`.
2. Update `docs/api/arcade.openapi.yaml` and this page.
3. Update `src/arcade/arcade-api.ts`; `npx vitest run tests/arcade-contract.test.ts`
   must pass. The Edge Functions' `TAG` / `MAP_ID` / `UUID` patterns are held
   to the OpenAPI ones by the same test.
4. Redeploy the functions you touched (`supabase functions deploy <name>`).
