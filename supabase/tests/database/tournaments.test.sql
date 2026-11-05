-- Hall of machines online (#490): tapes name their physics binary and the
-- verdict names the binary that replayed it (Slice B); weekly tournaments
-- rank verified runs only, one per player, and freeze into final results
-- once the verifier is done (Slice C). Run with `supabase test db` (pgTAP).

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated', true);

-- --------------------------------------------------- Slice B: the binary
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","is_anonymous":true}';
select lives_ok(
  $$insert into public.replays (payload) values ('{"version":3,"seed":1,"mapId":"pin-test","physicsEngine":"wasm-owner","finalScore":10,"compressedFrames":"60:0,0,0,0,0,0,-","wasmSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,
  'a player uploads a tape stamped with its binary'
);
select is(
  (select wasm_sha256 from public.replays where map_id = 'pin-test'),
  repeat('a', 64),
  'the binary is derived from the payload'
);
select lives_ok(
  $$insert into public.replays (payload) values ('{"version":3,"seed":2,"mapId":"pin-test-bad","physicsEngine":"wasm-owner","finalScore":10,"compressedFrames":"60:0,0,0,0,0,0,-","wasmSha256":"not-a-hash"}')$$,
  'a malformed stamp does not refuse the upload'
);
select is((select wasm_sha256 from public.replays where map_id = 'pin-test-bad'), null, '… it is dropped');
select throws_ok(
  $$insert into public.replays (payload, wasm_sha256) values ('{"version":3,"seed":3,"mapId":"x","physicsEngine":"wasm-owner","finalScore":0,"frames":[]}', repeat('b', 64))$$,
  '42501', null, 'a client cannot set wasm_sha256 itself'
);
reset role;

insert into public.scores (profile_id, name, map_id, score, replay_id)
select '00000000-0000-4000-8000-0000000000e1', 'PIN', 'pin-test', 10, id from public.replays where map_id = 'pin-test';
set local role service_role;
select lives_ok(
  $$select public.record_score_verification((select id from public.scores where name = 'PIN'), true, 'build1', 10, null, '0123456789abcdef', repeat('c', 64))$$,
  'the verifier records the binary that replayed the run'
);
select is((select verify_wasm_sha256 from public.scores where name = 'PIN'), repeat('c', 64), '… on the score row');
select lives_ok(
  $$select public.record_score_verification((select id from public.scores where name = 'PIN'), true, 'build1', 10, null, '0123456789abcdef')$$,
  'a verifier that does not send the binary yet still records'
);
reset role;

-- ------------------------------------------------ Slice C: tournaments
-- Two past weeks and this one. Runs are seeded as the table owner (verified,
-- timestamps) while each week is open, then the weeks are moved into the past.
insert into public.challenges (id, kind, board, seed, cascade_seed, map_id, target_score, starts_at, expires_at, title)
values
  ('00000000-0000-4000-8000-00000000a040', 'weekly', 'weekly-test-W40', 40, 40, 'neon-helix', 0, now() - interval '1 day', now() + interval '1 day', 'W40'),
  ('00000000-0000-4000-8000-00000000a039', 'weekly', 'weekly-test-W39', 39, 39, 'neon-helix', 0, now() - interval '1 day', now() + interval '1 day', 'W39');

insert into public.replays (id, profile_id, payload)
values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000e1', '{"version":3,"seed":40,"mapId":"neon-helix","physicsEngine":"wasm-owner","finalScore":1200,"frames":[]}'),
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-0000000000e2', '{"version":3,"seed":40,"mapId":"neon-helix","physicsEngine":"wasm-owner","finalScore":1200,"frames":[]}'),
  ('00000000-0000-4000-8000-00000000b003', '00000000-0000-4000-8000-0000000000e3', '{"version":3,"seed":40,"mapId":"neon-helix","physicsEngine":"wasm-owner","finalScore":5000,"frames":[]}');

insert into public.scores (profile_id, name, map_id, score, challenge_id, replay_id, verified, verify_reason, created_at)
values
  -- W40: AAA's best is 1200 (its 900 is not a second row); BBB ties 1200 later; CCC is pending 5000 and rejected at 9000.
  ('00000000-0000-4000-8000-0000000000e1', 'AAA', 'weekly-test-W40', 900, '00000000-0000-4000-8000-00000000a040', null, true, null, now() - interval '5 hours'),
  ('00000000-0000-4000-8000-0000000000e1', 'AAA', 'weekly-test-W40', 1200, '00000000-0000-4000-8000-00000000a040', '00000000-0000-4000-8000-00000000b001', true, null, now() - interval '4 hours'),
  ('00000000-0000-4000-8000-0000000000e2', 'BBB', 'weekly-test-W40', 1200, '00000000-0000-4000-8000-00000000a040', '00000000-0000-4000-8000-00000000b002', true, null, now() - interval '3 hours'),
  ('00000000-0000-4000-8000-0000000000e3', 'CCC', 'weekly-test-W40', 5000, '00000000-0000-4000-8000-00000000a040', '00000000-0000-4000-8000-00000000b003', false, null, now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000000e3', 'CCC', 'weekly-test-W40', 9000, '00000000-0000-4000-8000-00000000a040', null, false, 'score mismatch', now() - interval '2 hours'),
  -- W39: one verified run, and one the verifier never reached.
  ('00000000-0000-4000-8000-0000000000e1', 'AAA', 'weekly-test-W39', 700, '00000000-0000-4000-8000-00000000a039', null, true, null, now() - interval '6 hours'),
  ('00000000-0000-4000-8000-0000000000e2', 'BBB', 'weekly-test-W39', 800, '00000000-0000-4000-8000-00000000a039', null, false, null, now() - interval '6 hours');

insert into public.ghost_tracks (replay_id, stride, samples, track)
values
  ('00000000-0000-4000-8000-00000000b001', 2, 1, 'AQAAAAIAAAADAAAA'),
  ('00000000-0000-4000-8000-00000000b002', 2, 1, 'BAAAAAUAAAAGAAAA');

-- W40 ended an hour ago, W39 two days ago.
update public.challenges set starts_at = now() - interval '8 days', expires_at = now() - interval '1 hour' where board = 'weekly-test-W40';
update public.challenges set starts_at = now() - interval '9 days', expires_at = now() - interval '2 days' where board = 'weekly-test-W39';

create temp table this_week on commit drop as select * from public.current_weekly_challenge();
grant all on this_week to public;

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select results_eq(
  $$select rank, name, score, final, has_ghost from public.tournament_standings where board = 'weekly-test-W40' order by rank$$,
  $$values (1, 'AAA', 1200::bigint, false, true), (2, 'BBB', 1200::bigint, false, true)$$,
  'live standings: verified runs only, one per player, ties to the earlier run'
);
select is(
  (select status from public.tournaments where board = 'weekly-test-W40'),
  'verifying',
  'an ended week with a run still pending is verifying'
);
select is(
  (select status from public.tournaments where board = (select board from this_week)),
  'open',
  'this week is open'
);
select results_eq(
  $$select entries, leader_name, leader_score from public.tournaments where board = 'weekly-test-W40'$$,
  $$values (2, 'AAA', 1200::bigint)$$,
  'the archive row counts entries and names the leader'
);
select is(
  (select count(*)::int from public.tournament_ghosts('weekly-test-W40', 10)),
  2,
  'the top verified runs with ghosts, best first'
);
select is(
  (select name from public.tournament_ghosts('weekly-test-W40', 1)),
  'AAA',
  '… p_limit takes the leader alone'
);
select is(
  (select track from public.tournament_ghosts('weekly-test-W40') where rank = 2),
  'BAAAAAUAAAAGAAAA',
  '… with its track'
);
select is((select count(*)::int from public.tournament_standings where mine), 0, 'an anonymous reader owns no row');
select throws_ok($$select * from public.freeze_weekly_tournaments()$$, '42501', null, 'anon cannot freeze a tournament');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select board, name, rank from public.tournament_standings where mine order by board$$,
  $$values ('weekly-test-W40', 'BBB', 2)$$,
  'mine marks the caller''s own rows (its pending W39 run is on no board)'
);
select throws_ok($$select public.rotate_weekly_tournament()$$, '42501', null, 'a player cannot rotate the board');
select throws_ok(
  $$insert into public.tournament_results (challenge_id, board, rank, name, score, played_at) values ('00000000-0000-4000-8000-00000000a040', 'weekly-test-W40', 1, 'BBB', 999999, now())$$,
  '42501', null, 'a player cannot write results'
);
reset role;

-- The pending W40 run holds that week; W39 is past the one-day grace.
set local role service_role;
select results_eq(
  $$select frozen_board, entries from public.freeze_weekly_tournaments()$$,
  $$values ('weekly-test-W39', 1)$$,
  'a week with a run still pending waits; one past the grace freezes anyway'
);
select lives_ok(
  $$select public.record_score_verification(
      (select id from public.scores where name = 'CCC' and score = 5000), true, 'build1', 5000, null, '0123456789abcdef')$$,
  'the verifier confirms the last pending W40 run'
);
create temp table rotated on commit drop as select public.rotate_weekly_tournament() as summary;
select is(
  (select summary -> 'frozen' from rotated),
  '[{"board": "weekly-test-W40", "entries": 3}]'::jsonb,
  'the hourly job freezes W40 now'
);
select is(
  (select summary ->> 'current' from rotated),
  (select board from this_week),
  '… and opens this week'
);
select is(
  (select count(*)::int from public.freeze_weekly_tournaments()),
  0,
  'freezing again touches nothing'
);
select lives_ok(
  $$select public.record_score_verification(
      (select id from public.scores where name = 'BBB' and score = 800), true, 'build1', 800, null, '0123456789abcdef')$$,
  'a W39 run verified after its week froze'
);
reset role;

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select results_eq(
  $$select rank, name, score, final from public.tournament_standings where board = 'weekly-test-W40' order by rank$$,
  $$values (1, 'CCC', 5000::bigint, true), (2, 'AAA', 1200::bigint, true), (3, 'BBB', 1200::bigint, true)$$,
  'frozen W40 results are final'
);
select results_eq(
  $$select rank, name, score from public.tournament_standings where board = 'weekly-test-W39'$$,
  $$values (1, 'AAA', 700::bigint)$$,
  'a run verified after the freeze does not change final results'
);
select is(
  (select status from public.tournaments where board = 'weekly-test-W40'),
  'final',
  'a frozen week is final'
);
select is(
  (select count(*)::int from public.tournament_results where board = 'weekly-test-W40'),
  3,
  'results are public'
);
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e3","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select board, rank, final from public.tournament_standings where mine$$,
  $$values ('weekly-test-W40', 1, true)$$,
  'mine finds the caller in frozen results too'
);
reset role;

select is(
  (select count(*)::int from public.challenges where board = (select board from this_week) and frozen_at is not null),
  0,
  'this week is not frozen'
);

select * from finish();
rollback;
