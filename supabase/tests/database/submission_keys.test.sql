-- Exactly-once run submission (#503 A4) and unranked runs (#503 A3).
-- Run with `supabase test db` (pgTAP). `submit` below is what
-- supabase/functions/_shared/arcade.ts `idempotent` does around submit-score:
-- claim the key, insert only on a fresh claim, store the answer.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated', true);

-- The Edge Function's flow, run as the caller.
create function pg_temp.submit(p_key text, p_score bigint)
returns jsonb
language plpgsql
as $$
declare
  claim jsonb := public.claim_submission(p_key, 'score');
  answer jsonb;
  new_id bigint;
begin
  if not (claim ->> 'claimed')::boolean then
    return coalesce(claim -> 'response', claim);
  end if;
  insert into public.scores (name, map_id, score) values ('IDM', 'idem-test', p_score) returning id into new_id;
  answer := jsonb_build_object('success', true, 'score_id', new_id, 'rank', 1, 'verified', false);
  perform public.complete_submission(p_key, 'score', answer);
  return answer;
end;
$$;
grant execute on function pg_temp.submit(text, bigint) to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated","is_anonymous":true}';

select throws_ok($$select * from public.submission_keys$$, '42501', null, 'a player cannot read submission keys');
select throws_ok(
  $$insert into public.submission_keys (profile_id, key, kind) values ('00000000-0000-4000-8000-0000000000d4', 'hand-made', 'score')$$,
  '42501', null, 'nor write them directly'
);

create temp table answers (n int, body jsonb) on commit drop;
grant all on answers to authenticated;
insert into answers select 1, pg_temp.submit('11111111-2222-4333-8444-555555555555:score', 4200);
insert into answers select 2, pg_temp.submit('11111111-2222-4333-8444-555555555555:score', 4200);

select is((select count(*)::int from public.scores where map_id = 'idem-test'), 1, 'a repeated key inserts no second row');
select is((select body from answers where n = 2), (select body from answers where n = 1), 'and answers with the first response');
select is(
  ((select body from answers where n = 1) ->> 'score_id')::bigint,
  (select id from public.scores where map_id = 'idem-test'),
  'the stored response cites the one row'
);

select is(
  public.claim_submission('11111111-2222-4333-8444-555555555555:replay', 'replay') ->> 'claimed',
  'true',
  'the same submission id is a separate key per kind'
);
select is(
  public.claim_submission('11111111-2222-4333-8444-555555555555:replay', 'replay'),
  '{"claimed": false, "pending": true}'::jsonb,
  'a repeat while the first is still running is told it is pending'
);
select lives_ok(
  $$select public.release_submission('11111111-2222-4333-8444-555555555555:replay', 'replay')$$,
  'a failed write releases its claim'
);
select is(
  public.claim_submission('11111111-2222-4333-8444-555555555555:replay', 'replay') ->> 'claimed',
  'true',
  'so the retry claims it again'
);
select lives_ok(
  $$select public.release_submission('11111111-2222-4333-8444-555555555555:score', 'score')$$,
  'release on a completed key is a no-op'
);
select is(
  public.claim_submission('11111111-2222-4333-8444-555555555555:score', 'score') -> 'response' ->> 'success',
  'true',
  'it never drops a stored answer'
);

-- An unranked run (#503 A3): stored, already decided, nowhere on the board.
select lives_ok(
  $$insert into public.scores (name, map_id, score, ranked) values ('UNR', 'idem-test', 999999, false)$$,
  'a player submits an unranked run'
);
select is((select verify_reason from public.scores where name = 'UNR'), 'unranked', 'it is stored as unranked');
select is((select count(*)::int from public.leaderboard where name = 'UNR'), 0, 'and is not on the board');
select is(public.player_rank('idem-test', 5000), 1, 'nor counted in a rank');
reset role;

-- Player E's identical key is their own.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e5","role":"authenticated","is_anonymous":true}';
select is(
  public.claim_submission('11111111-2222-4333-8444-555555555555:score', 'score') ->> 'claimed',
  'true',
  'keys are per player'
);
reset role;

set local role service_role;
select is(
  (select count(*)::int from public.claim_score_verifications(32) where map_id = 'idem-test' and score = 999999),
  0,
  'the verifier is never handed an unranked run'
);
reset role;

select * from finish();
rollback;
