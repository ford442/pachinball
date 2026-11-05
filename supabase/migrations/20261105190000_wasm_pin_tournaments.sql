-- Hall of machines online (#490): the verifier pinned to the shipped physics
-- binary (Slice B) and weekly tournaments with frozen results and race
-- ghosts (Slice C). Contract: docs/API_CONTRACT.md.

-- ------------------------------------------------- Slice B: the binary
--
-- A tape stamps the SHA-256 of the PhysicsModule.wasm it was played on
-- (`wasmSha256`); the verifier replays it on an archived build shipping that
-- binary and records which binary replayed it.

alter table public.replays
  add column wasm_sha256 text check (wasm_sha256 is null or wasm_sha256 ~ '^[0-9a-f]{64}$');

alter table public.scores
  add column verify_wasm_sha256 text check (verify_wasm_sha256 is null or verify_wasm_sha256 ~ '^[0-9a-f]{64}$');

-- As before (20261016024958_arcade_core.sql), plus wasm_sha256: a malformed
-- stamp is dropped rather than refused, so an older client's tape still uploads.
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
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'replay payload has a malformed numeric field' using errcode = '22023';
end;
$$;

revoke execute on function public.replays_derive() from public, anon, authenticated;

-- The verdict now names the binary that replayed the run. The new argument
-- has a default, so a verifier that does not send it yet still records.
drop function public.record_score_verification(bigint, boolean, text, bigint, text, text);

create function public.record_score_verification(
  p_score_id bigint,
  p_verified boolean,
  p_verifier_version text,
  p_verifier_score bigint,
  p_reason text,
  p_state_hash text,
  p_wasm_sha256 text default null
)
returns void
language sql
set search_path = ''
as $$
  update public.scores
  set verified = p_verified,
      verifier_version = left(p_verifier_version, 64),
      verifier_score = p_verifier_score,
      verify_reason = case when p_verified then null else left(coalesce(nullif(p_reason, ''), 'rejected'), 500) end,
      verify_state_hash = left(p_state_hash, 32),
      verify_wasm_sha256 = case when p_wasm_sha256 ~ '^[0-9a-f]{64}$' then p_wasm_sha256 end,
      verified_at = now(),
      verify_claimed_at = null
  where id = p_score_id
$$;

revoke execute on function public.record_score_verification(bigint, boolean, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.record_score_verification(bigint, boolean, text, bigint, text, text, text) to service_role;

-- ------------------------------------------ Slice C: weekly tournaments
--
-- The table of the week (current_weekly_challenge) is the tournament. Its
-- standings count verified runs only — a pending run shows nowhere until the
-- verifier confirms it — one row per player, their best run; ties go to the
-- earlier run. After the week ends, `freeze_weekly_tournaments` copies the
-- standings into `tournament_results` once no run on the board is still
-- waiting for the verifier, or a day after the end at the latest; from then
-- the results are final. pg_cron runs `rotate_weekly_tournament` hourly.

alter table public.challenges add column frozen_at timestamptz;

create table public.tournament_results (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  board text not null,
  rank int not null check (rank >= 1),
  -- The run behind the row; the row stays if the run is ever deleted.
  score_id bigint references public.scores (id) on delete set null,
  name text not null check (name ~ '^[A-Z]{3}$'),
  score bigint not null check (score >= 0),
  replay_id uuid references public.replays (id) on delete set null,
  played_at timestamptz not null,
  frozen_at timestamptz not null default now()
);

create index tournament_results_board on public.tournament_results (board, rank);
create index tournament_results_challenge on public.tournament_results (challenge_id, rank);
create unique index tournament_results_score on public.tournament_results (challenge_id, score_id) where score_id is not null;
create index tournament_results_score_fk on public.tournament_results (score_id) where score_id is not null;
create index tournament_results_replay on public.tournament_results (replay_id) where replay_id is not null;
create index scores_challenge_verified on public.scores (challenge_id, score desc) where verified and challenge_id is not null;

comment on table public.tournament_results is 'Final standings of a frozen weekly tournament: verified runs only, one per player. Written by freeze_weekly_tournaments only.';

alter table public.tournament_results enable row level security;
revoke all on public.tournament_results from anon, authenticated;
grant select on public.tournament_results to anon, authenticated;
create policy "tournament results are public" on public.tournament_results
  for select to anon, authenticated using (true);

-- The standings of one weekly board right now: each player's best verified
-- run, ranked. `mine` marks the caller's own row; players' ids never leave
-- (security definer for that reason only — everything else is public).
create function public.weekly_standings(p_challenge_id uuid)
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
    where s.challenge_id = p_challenge_id and s.verified
    order by s.profile_id, s.score desc, s.created_at asc
  ) b
$$;

revoke execute on function public.weekly_standings(uuid) from public;
grant execute on function public.weekly_standings(uuid) to anon, authenticated, service_role;

-- GET /rest/v1/tournament_standings?board=eq.<board>&order=rank.asc&limit=<n>
-- A finished week's frozen results, or an open (or still verifying) week's
-- live standings: `final` says which. `mine=is.true` with a player's token
-- is that player's own row.
create view public.tournament_standings
with (security_invoker = true)
as
select r.challenge_id, r.board, r.rank, r.name, r.score, r.replay_id, r.played_at,
       true as final,
       exists (select 1 from public.scores s where s.id = r.score_id and s.profile_id = (select auth.uid())) as mine,
       exists (select 1 from public.ghost_tracks g where g.replay_id = r.replay_id) as has_ghost
from public.tournament_results r
union all
select c.id, c.board, w.rank, w.name, w.score, w.replay_id, w.played_at,
       false,
       w.mine,
       exists (select 1 from public.ghost_tracks g where g.replay_id = w.replay_id)
from public.challenges c
cross join lateral public.weekly_standings(c.id) w
where c.kind = 'weekly' and c.frozen_at is null;

grant select on public.tournament_standings to anon, authenticated;

-- GET /rest/v1/tournaments?order=starts_at.desc&limit=<n> — this week and the
-- archive. `status`: open (inside the week), verifying (ended, results not
-- frozen yet), final.
create view public.tournaments
with (security_invoker = true)
as
select c.id as challenge_id, c.board, c.title, c.seed, c.cascade_seed, c.map_id,
       c.starts_at, c.expires_at, c.frozen_at,
       case when c.frozen_at is not null then 'final' when now() < c.expires_at then 'open' else 'verifying' end as status,
       (select count(*)::int from public.tournament_standings t where t.challenge_id = c.id) as entries,
       leader.name as leader_name,
       leader.score as leader_score
from public.challenges c
left join lateral (
  select t.name, t.score from public.tournament_standings t
  where t.challenge_id = c.id
  order by t.rank, t.played_at
  limit 1
) leader on true
where c.kind = 'weekly';

grant select on public.tournaments to anon, authenticated;

-- POST /rest/v1/rpc/tournament_ghosts { p_board, p_limit } → the top
-- p_limit (1–5, default 3) verified runs on the board that have a ghost
-- recorded by the verifier, best first, with their tracks: the ghosts a
-- tournament run races.
create function public.tournament_ghosts(p_board text, p_limit int default 3)
returns table (rank int, name text, score bigint, replay_id uuid, stride int, samples int, track text)
language sql
stable
set search_path = ''
as $$
  select t.rank, t.name, t.score, t.replay_id, g.stride, g.samples, g.track
  from public.tournament_standings t
  join public.ghost_tracks g on g.replay_id = t.replay_id
  where t.board = p_board
  order by t.rank, t.played_at
  limit greatest(1, least(coalesce(p_limit, 3), 5))
$$;

revoke execute on function public.tournament_ghosts(text, int) from public;
grant execute on function public.tournament_ghosts(text, int) to anon, authenticated;

-- Freeze every weekly tournament that has ended and has nothing left for the
-- verifier (or ended more than p_grace ago): its standings become
-- tournament_results and the board is final. Safe to run at any time and
-- concurrently; a frozen week is never touched again.
create function public.freeze_weekly_tournaments(p_grace interval default '24 hours')
returns table (frozen_board text, entries int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch record;
  n int;
begin
  for ch in
    select c.id, c.board
    from public.challenges c
    where c.kind = 'weekly'
      and c.frozen_at is null
      and c.expires_at <= now()
      and (
        c.expires_at + p_grace <= now()
        or not exists (
          select 1 from public.scores s
          where s.challenge_id = c.id and not s.verified and s.verify_reason is null
        )
      )
    order by c.expires_at
    for update of c skip locked
  loop
    insert into public.tournament_results (challenge_id, board, rank, score_id, name, score, replay_id, played_at)
    select ch.id, ch.board, w.rank, w.score_id, w.name, w.score, w.replay_id, w.played_at
    from public.weekly_standings(ch.id) w;
    get diagnostics n = row_count;
    update public.challenges set frozen_at = now() where id = ch.id;
    frozen_board := ch.board;
    entries := n;
    return next;
  end loop;
end;
$$;

-- The hourly job: freeze what has finished, and open this week's table.
create function public.rotate_weekly_tournament()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  frozen jsonb;
  current_board text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('board', f.frozen_board, 'entries', f.entries)), '[]'::jsonb)
    into frozen
    from public.freeze_weekly_tournaments() f;
  select c.board into current_board from public.current_weekly_challenge() c;
  return jsonb_build_object('frozen', frozen, 'current', current_board);
end;
$$;

revoke execute on function public.freeze_weekly_tournaments(interval) from public, anon, authenticated;
revoke execute on function public.rotate_weekly_tournament() from public, anon, authenticated;
grant execute on function public.freeze_weekly_tournaments(interval) to service_role;
grant execute on function public.rotate_weekly_tournament() to service_role;

-- The schedule: hourly at minute 7, so a week opens a few minutes after
-- Monday 00:00 UTC and freezes within the hour its last run is verified.
-- Where pg_cron is unavailable (a plain Postgres) nothing is scheduled:
-- current_weekly_challenge still opens each week on first ask, and
-- `select public.rotate_weekly_tournament()` freezes by hand.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('rotate-weekly-tournament', '7 * * * *', 'select public.rotate_weekly_tournament()');
  end if;
exception
  when others then
    raise notice 'pg_cron unavailable, rotate_weekly_tournament is not scheduled: %', sqlerrm;
end;
$$;
