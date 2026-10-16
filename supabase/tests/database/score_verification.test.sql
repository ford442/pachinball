-- Score verification (#444 Slice C): the default board shows verified runs and
-- runs pending for less than a day, never rejected ones; only the service role
-- claims scores and records verdicts. Run with `supabase test db` (pgTAP).

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, aud, role, is_anonymous)
values ('00000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', true);

-- Seeded as the table owner: created_at and the verifier columns are not client-settable.
insert into public.replays (id, profile_id, payload)
values ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000c3',
        '{"version":3,"seed":9,"mapId":"verify-test","physicsEngine":"wasm-owner","finalScore":900,"compressedFrames":"120:0,0,0,0,0,0,-"}');
insert into public.scores (profile_id, name, map_id, score, replay_id, verified, verify_reason, created_at)
values
  ('00000000-0000-4000-8000-0000000000c3', 'NEW', 'verify-test', 900, '00000000-0000-4000-8000-00000000f001', false, null, now()),
  ('00000000-0000-4000-8000-0000000000c3', 'OLD', 'verify-test', 800, null, false, null, now() - interval '25 hours'),
  ('00000000-0000-4000-8000-0000000000c3', 'BAD', 'verify-test', 5000000, null, false, 'score-mismatch', now()),
  ('00000000-0000-4000-8000-0000000000c3', 'YES', 'verify-test', 700, null, true, null, now() - interval '3 days');

select results_eq(
  $$select name, verification from public.leaderboard where map_id = 'verify-test' order by rank$$,
  $$values ('NEW', 'pending'), ('YES', 'verified')$$,
  'the board shows fresh pending and verified runs, not rejected or day-old pending ones'
);
select is(public.player_rank('verify-test', 750), 2, 'player_rank skips the hidden rows');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated","is_anonymous":true}';
select throws_ok($$select * from public.claim_score_verifications()$$, '42501', null, 'a player cannot claim verifications');
select throws_ok(
  $$select public.record_score_verification(1, true, 'x', 1, null, null)$$,
  '42501', null, 'a player cannot record a verdict'
);
reset role;

set local role service_role;
create temp table claimed on commit drop as select * from public.claim_score_verifications(10);
select is((select count(*)::int from claimed where map_id = 'verify-test'), 2, 'the verifier claims both pending runs');
select is(
  (select payload ->> 'mapId' from claimed where score_id = (select id from public.scores where name = 'NEW')),
  'verify-test',
  'a claim carries the replay payload'
);
select is(
  (select physics_engine from claimed where score_id = (select id from public.scores where name = 'NEW')),
  'wasm-owner',
  'and the engine it was recorded on'
);
select is(
  (select replay_id from claimed where score_id = (select id from public.scores where name = 'OLD')),
  null,
  'a score without a replay is claimed too (to be rejected)'
);
select is((select attempts from claimed where score_id = (select id from public.scores where name = 'NEW')), 1, 'claiming counts an attempt');
select is(
  (select count(*)::int from public.claim_score_verifications(10) where map_id = 'verify-test'),
  0,
  'a fresh claim is not handed out twice'
);

do $$ begin
  perform public.record_score_verification((select id from public.scores where name = 'NEW'), true, 'abc123', 900, null, '0123456789abcdef');
end $$;
select is(
  (select verification from public.leaderboard where name = 'NEW'),
  'verified',
  'a verified run shows as verified'
);
select is((select verify_claimed_at from public.scores where name = 'NEW'), null, 'the verdict releases the claim');

do $$ begin
  perform public.record_score_verification((select id from public.scores where name = 'OLD'), false, 'abc123', null, '', null);
end $$;
select is((select verify_reason from public.scores where name = 'OLD'), 'rejected', 'a rejection always has a reason');
select is((select count(*)::int from public.leaderboard where name = 'OLD'), 0, 'a rejected run is not on the board');
reset role;

select * from finish();
rollback;
