-- Machines that play differently (#556 Slice 1): every run names the rules it
-- was played under, and a board is keyed by (board, rules_hash).
--
-- `rules_hash` is the SHA-256 (hex) of the run's rules as canonical JSON
-- (src/rules/rules-hash.ts). A replay tape of schema 4 carries it
-- (`rulesHash`); a tape from before carries none and was played under the
-- vanilla rules of the time, whose hash is the constant below
-- (LEGACY_RULES_HASH in src/rules/rules-hash.ts and
-- services/replay-verifier/judge.mjs; tests/rules-hash.test.ts pins all three).
--
-- The same table under other rules is another board: the leaderboard view
-- ranks within (map_id, rules_hash, adventure_level), player_rank takes the
-- hash, and a score must name the rules of the replay it cites (and of the
-- challenge it is entered in). The verifier replays the tape under the rules
-- it names and rejects a run whose submission and tape disagree.
-- Contract: docs/API_CONTRACT.md.

-- ----------------------------------------------------------------- replays

alter table public.replays
  add column rules_hash text not null
    default 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'
    check (rules_hash ~ '^[0-9a-f]{64}$');

-- As before (20261105190000_wasm_pin_tournaments.sql), plus rules_hash: a
-- schema 4 tape must name well-formed rules; an older one played the legacy
-- vanilla rules.
create or replace function public.replays_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.payload) <> 'object' then
    raise exception 'replay payload must be a JSON object' using errcode = '22023';
  end if;
  new.schema_version := coalesce((new.payload ->> 'version')::int, 1);
  new.seed := ((new.payload ->> 'seed')::bigint) & 4294967295;
  new.map_id := left(coalesce(new.payload ->> 'mapId', 'neon-helix'), 64);
  new.physics_engine := left(coalesce(new.payload ->> 'physicsEngine', 'rapier'), 32);
  new.snapshot_version := (new.payload ->> 'snapshotVersion')::int;
  new.static_hash := left(new.payload ->> 'staticHash', 32);
  new.feeder_tunables_hash := left(new.payload ->> 'feederTunablesHash', 32);
  new.wasm_sha256 := case when (new.payload ->> 'wasmSha256') ~ '^[0-9a-f]{64}$' then new.payload ->> 'wasmSha256' end;
  new.final_score := coalesce((new.payload ->> 'finalScore')::bigint, 0);
  new.frame_count := public.replay_frame_count(new.payload);
  if (new.payload ->> 'rulesHash') ~ '^[0-9a-f]{64}$' then
    new.rules_hash := new.payload ->> 'rulesHash';
  elsif new.schema_version < 4 then
    new.rules_hash := 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528';
  else
    raise exception 'a schema % replay names the rules it was played under (rulesHash)', new.schema_version
      using errcode = '22023';
  end if;
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'replay payload has a malformed numeric field' using errcode = '22023';
end;
$$;

revoke execute on function public.replays_derive() from public, anon, authenticated;

-- -------------------------------------------------------------- challenges

-- The rules a challenge's runs must be played under: its replay's, when it
-- cites one; else the legacy vanilla rules (the weekly table of the week).
alter table public.challenges
  add column rules_hash text not null
    default 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'
    check (rules_hash ~ '^[0-9a-f]{64}$');

create function public.challenges_rules_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.replay_id is not null then
    select r.rules_hash into new.rules_hash from public.replays r where r.id = new.replay_id;
    new.rules_hash := coalesce(new.rules_hash, 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528');
  end if;
  return new;
end;
$$;

create trigger challenges_rules_hash
  before insert on public.challenges
  for each row execute function public.challenges_rules_hash();

revoke execute on function public.challenges_rules_hash() from public, anon, authenticated;

-- ------------------------------------------------------------------ scores

alter table public.scores
  add column rules_hash text not null
    default 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'
    check (rules_hash ~ '^[0-9a-f]{64}$');

grant insert (rules_hash) on public.scores to authenticated;

-- A board is (map_id, rules_hash): one index serves the view, player_rank and
-- a plain map_id filter.
drop index public.scores_board;
create index scores_board on public.scores (map_id, rules_hash, adventure_level, score desc);

-- A score names the rules its replay was played under, and a challenge run
-- the challenge's. Runs after scores_check_replay_owner (triggers fire in
-- name order), so a foreign replay's rules are never compared.
create function public.scores_check_rules_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  wanted text;
begin
  if new.replay_id is not null then
    select r.rules_hash into wanted from public.replays r where r.id = new.replay_id;
    if wanted is not null and wanted <> new.rules_hash then
      raise exception 'the score names rules %, but its replay was played under %', left(new.rules_hash, 12), left(wanted, 12)
        using errcode = '22023';
    end if;
  end if;
  if new.challenge_id is not null then
    select c.rules_hash into wanted from public.challenges c where c.id = new.challenge_id;
    if wanted is not null and wanted <> new.rules_hash then
      raise exception 'the challenge is played under rules %, not %', left(wanted, 12), left(new.rules_hash, 12)
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger scores_check_rules_hash
  before insert on public.scores
  for each row execute function public.scores_check_rules_hash();

revoke execute on function public.scores_check_rules_hash() from public, anon, authenticated;

-- ------------------------------------------------------------------ boards

-- As 20261016052208_score_verification.sql, ranked within (map_id,
-- rules_hash, adventure_level); `rules_hash` is the new last column.
-- GET /rest/v1/leaderboard?map_id=eq.<id>&rules_hash=eq.<hash>&order=rank&limit=10
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  s.id,
  rank() over (
    partition by s.map_id, s.rules_hash, s.adventure_level
    order by s.score desc, s.created_at asc
  )::int as rank,
  s.name,
  s.score,
  s.map_id,
  s.adventure_level,
  s.balls,
  s.combo_max,
  s.created_at as date,
  s.replay_id,
  s.challenge_id,
  s.verified,
  case when s.verified then 'verified' else 'pending' end as verification,
  s.rules_hash
from public.scores s
where s.verified or (s.verify_reason is null and s.created_at > now() - interval '24 hours');

grant select on public.leaderboard to anon, authenticated;

-- POST /rest/v1/rpc/player_rank { p_map_id, p_score, p_adventure_level, p_rules_hash }
-- An older client that sends no hash is ranked on the legacy vanilla board.
drop function public.player_rank(text, bigint, text);

create function public.player_rank(
  p_map_id text,
  p_score bigint,
  p_adventure_level text default null,
  p_rules_hash text default 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'
)
returns int
language sql
stable
set search_path = ''
as $$
  select (count(*) + 1)::int
  from public.scores s
  where s.map_id = p_map_id
    and s.rules_hash = p_rules_hash
    and s.adventure_level is not distinct from p_adventure_level
    and s.score > p_score
    and (s.verified or (s.verify_reason is null and s.created_at > now() - interval '24 hours'))
$$;

revoke execute on function public.player_rank(text, bigint, text, text) from public;
grant execute on function public.player_rank(text, bigint, text, text) to anon, authenticated;

-- A weekly tournament's standings count runs under its rules only (a run
-- under other rules is refused on insert already; this keeps the standings
-- right for rows from before).
create or replace function public.weekly_standings(p_challenge_id uuid)
returns table (rank int, score_id bigint, name text, score bigint, replay_id uuid, played_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select rank() over (order by b.score desc, b.created_at asc)::int,
         b.id, b.name, b.score, b.replay_id, b.created_at,
         coalesce(b.profile_id = (select auth.uid()), false)
  from (
    select distinct on (s.profile_id) s.profile_id, s.id, s.name, s.score, s.replay_id, s.created_at
    from public.scores s
    join public.challenges c on c.id = s.challenge_id
    where s.challenge_id = p_challenge_id and s.verified and s.rules_hash = c.rules_hash
    order by s.profile_id, s.score desc, s.created_at asc
  ) b
$$;

-- ---------------------------------------------------------------- verifier

-- The verifier sees the rules the score names and the rules its challenge is
-- played under (judge.mjs `precheck` compares both with the tape's).
drop function public.claim_score_verifications(int, interval);

create function public.claim_score_verifications(p_limit int default 4, p_stale interval default '15 minutes')
returns table (
  score_id bigint,
  score bigint,
  map_id text,
  replay_id uuid,
  payload jsonb,
  physics_engine text,
  attempts int,
  submitted_at timestamptz,
  challenge_id uuid,
  challenge_kind text,
  challenge_seed bigint,
  challenge_cascade_seed bigint,
  challenge_board text,
  challenge_starts_at timestamptz,
  challenge_expires_at timestamptz,
  rules_hash text,
  challenge_rules_hash text
)
language sql
set search_path = ''
as $$
  with picked as (
    select s.id
    from public.scores s
    where not s.verified
      and s.verify_reason is null
      and (s.verify_claimed_at is null or s.verify_claimed_at < now() - p_stale)
    order by s.created_at
    limit greatest(1, least(p_limit, 32))
    for update skip locked
  ),
  claimed as (
    update public.scores s
    set verify_claimed_at = now(), verify_attempts = s.verify_attempts + 1
    from picked
    where s.id = picked.id
    returning s.id, s.score, s.map_id, s.replay_id, s.challenge_id, s.verify_attempts, s.created_at, s.rules_hash
  )
  select c.id, c.score, c.map_id, c.replay_id, r.payload, r.physics_engine, c.verify_attempts, c.created_at,
         c.challenge_id, ch.kind, ch.seed, ch.cascade_seed, ch.board, ch.starts_at, ch.expires_at,
         c.rules_hash, ch.rules_hash
  from claimed c
  left join public.replays r on r.id = c.replay_id
  left join public.challenges ch on ch.id = c.challenge_id
  order by c.created_at
$$;

revoke execute on function public.claim_score_verifications(int, interval) from public, anon, authenticated;
grant execute on function public.claim_score_verifications(int, interval) to service_role;
