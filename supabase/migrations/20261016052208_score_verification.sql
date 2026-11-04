-- Server-side score verification (#444 Slice C).
--
-- The replay verifier (services/replay-verifier, a Node + headless Chromium
-- worker) claims pending scores, replays each one's tape in the real game and
-- records the verdict with the service role. A score is:
--   pending  — verified = false, verify_reason is null (shown for 24 h)
--   verified — verified = true                          (shown, with a check)
--   rejected — verified = false, verify_reason set      (never shown)

alter table public.scores
  add column verify_claimed_at timestamptz,
  add column verify_attempts int not null default 0,
  -- getStateHash() at the end of the replay, for audits and re-verification.
  add column verify_state_hash text;

create index scores_pending on public.scores (created_at)
  where not verified and verify_reason is null;

-- The default board: verified runs, and runs still waiting less than a day.
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  s.id,
  rank() over (
    partition by s.map_id, s.adventure_level
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
  case when s.verified then 'verified' else 'pending' end as verification
from public.scores s
where s.verified or (s.verify_reason is null and s.created_at > now() - interval '24 hours');

create or replace function public.player_rank(p_map_id text, p_score bigint, p_adventure_level text default null)
returns int
language sql
stable
set search_path = ''
as $$
  select (count(*) + 1)::int
  from public.scores s
  where s.map_id = p_map_id
    and s.adventure_level is not distinct from p_adventure_level
    and s.score > p_score
    and (s.verified or (s.verify_reason is null and s.created_at > now() - interval '24 hours'))
$$;

-- Hand the verifier up to p_limit pending scores, oldest first, with their tapes.
-- A claim older than p_stale (a crashed verifier) is handed out again.
create function public.claim_score_verifications(p_limit int default 4, p_stale interval default '15 minutes')
returns table (
  score_id bigint,
  score bigint,
  map_id text,
  replay_id uuid,
  payload jsonb,
  physics_engine text,
  attempts int,
  submitted_at timestamptz
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
    returning s.id, s.score, s.map_id, s.replay_id, s.verify_attempts, s.created_at
  )
  select c.id, c.score, c.map_id, c.replay_id, r.payload, r.physics_engine, c.verify_attempts, c.created_at
  from claimed c
  left join public.replays r on r.id = c.replay_id
  order by c.created_at
$$;

-- The verdict. A rejection always carries its reason.
create function public.record_score_verification(
  p_score_id bigint,
  p_verified boolean,
  p_verifier_version text,
  p_verifier_score bigint,
  p_reason text,
  p_state_hash text
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
      verified_at = now(),
      verify_claimed_at = null
  where id = p_score_id
$$;

revoke execute on function public.claim_score_verifications(int, interval) from public, anon, authenticated;
revoke execute on function public.record_score_verification(bigint, boolean, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.claim_score_verifications(int, interval) to service_role;
grant execute on function public.record_score_verification(bigint, boolean, text, bigint, text, text) to service_role;
