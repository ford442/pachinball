-- Exactly-once run submission (#503 A4) and unranked runs (#503 A3).
--
-- A finished run is a replay upload then a score citing it. The client times a
-- request out after 8 s and queues the run; a request the service had already
-- committed was then stored twice on the next flush. Each run now carries one
-- submission id, and submit-replay / submit-score take an `Idempotency-Key`
-- (`<id>:replay`, `<id>:score`). The functions claim the key here before they
-- insert, store their answer with it, and answer a repeat with the stored
-- answer (supabase/functions/_shared/arcade.ts `idempotent`).
--
-- The table is service-only: RLS on, no policies, no grants. Players reach it
-- through the three security-definer functions below, which only ever touch
-- the caller's own keys (auth.uid()). Keys live 7 days — far longer than a run
-- waits in the offline queue — and each claim prunes the caller's expired ones.

create table public.submission_keys (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  kind text not null check (kind in ('replay', 'score')),
  -- The function's answer; null while the first request is still running.
  response jsonb check (response is null or octet_length(response::text) <= 4096),
  created_at timestamptz not null default now(),
  constraint submission_keys_once unique (profile_id, key, kind)
);

comment on table public.submission_keys is
  'Idempotency-Key -> stored answer of submit-replay / submit-score (#503 A4). Service-only; 7-day TTL.';

create index submission_keys_expiry on public.submission_keys (created_at);

alter table public.submission_keys enable row level security;
revoke all on public.submission_keys from public, anon, authenticated;
grant all on public.submission_keys to service_role;

-- Claim a key for the caller. Returns one of
--   {"claimed": true}                       — first time (or a stale claim taken over): do the write
--   {"claimed": false, "response": {...}}   — done before: answer with this, write nothing
--   {"claimed": false, "pending": true}     — the first request is still running
-- A claim with no answer after 2 minutes is a function that died mid-write: it is taken over.
create function public.claim_submission(p_key text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing public.submission_keys;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  delete from public.submission_keys
  where profile_id = uid and created_at < now() - interval '7 days';

  insert into public.submission_keys (profile_id, key, kind)
  values (uid, p_key, p_kind)
  on conflict on constraint submission_keys_once do nothing;
  if found then
    return jsonb_build_object('claimed', true);
  end if;

  update public.submission_keys k
  set created_at = now()
  where k.profile_id = uid and k.key = p_key and k.kind = p_kind
    and k.response is null and k.created_at < now() - interval '2 minutes';
  if found then
    return jsonb_build_object('claimed', true);
  end if;

  select * into existing from public.submission_keys k
  where k.profile_id = uid and k.key = p_key and k.kind = p_kind;
  if existing.response is null then
    return jsonb_build_object('claimed', false, 'pending', true);
  end if;
  return jsonb_build_object('claimed', false, 'response', existing.response);
end;
$$;

-- Store the answer of a claimed key. Never overwrites a stored answer.
create function public.complete_submission(p_key text, p_kind text, p_response jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.submission_keys
  set response = p_response
  where profile_id = auth.uid() and key = p_key and kind = p_kind and response is null
$$;

-- The write failed: free the key so the retry runs it. Never drops a stored answer.
create function public.release_submission(p_key text, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.submission_keys
  where profile_id = auth.uid() and key = p_key and kind = p_kind and response is null
$$;

revoke execute on function public.claim_submission(text, text) from public, anon;
revoke execute on function public.complete_submission(text, text, jsonb) from public, anon;
revoke execute on function public.release_submission(text, text) from public, anon;
grant execute on function public.claim_submission(text, text) to authenticated, service_role;
grant execute on function public.complete_submission(text, text, jsonb) to authenticated, service_role;
grant execute on function public.release_submission(text, text) to authenticated, service_role;

-- ------------------------------------------------------------ unranked runs

-- A run that hit a physics / sim fault (#503 A3) is submitted with
-- `ranked: false`: stored for the player, but its world may have diverged
-- from what a replay rebuilds, so it is never verified and never on a board.
-- It is stored as already decided (`verify_reason = 'unranked'`), which keeps
-- it out of `claim_score_verifications`, the leaderboard view, `player_rank`
-- and the tournament standings without touching any of them.
alter table public.scores add column ranked boolean not null default true;
grant insert (ranked) on public.scores to authenticated;

create function public.scores_unranked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.ranked then
    new.verified := false;
    new.verify_reason := 'unranked';
  end if;
  return new;
end;
$$;

revoke execute on function public.scores_unranked() from public, anon, authenticated;

create trigger scores_unranked
  before insert on public.scores
  for each row execute function public.scores_unranked();
