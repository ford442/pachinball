-- Row-level security and write rules for the arcade schema (#444 Slice B).
-- Run with `supabase test db` (pgTAP). Two anonymous players, A and B:
-- B cannot change A's score, nobody can mark their own score verified, saves
-- stay private, and the rate limit and replay-ownership rules hold.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', true);

select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2')),
  2,
  'every new auth user gets a profile'
);

-- ---------------------------------------------------------------- player A
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":true}';

select lives_ok(
  $$insert into public.scores (name, map_id, score, balls, combo_max) values ('AAA', 'rls-test', 5000, 1, 3)$$,
  'A submits a score'
);
select is(
  (select profile_id from public.scores where map_id = 'rls-test' and name = 'AAA'),
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'the score belongs to its submitter'
);
select is(
  (select verified from public.scores where map_id = 'rls-test' and name = 'AAA'),
  false,
  'a new score is unverified'
);
select throws_ok(
  $$insert into public.scores (name, map_id, score, verified) values ('AAA', 'rls-test', 1, true)$$,
  '42501', null,
  'a player cannot mark a score verified'
);
select throws_ok(
  $$insert into public.scores (profile_id, name, map_id, score)
    values ('00000000-0000-4000-8000-0000000000b2', 'AAA', 'rls-test', 1)$$,
  '42501', null,
  'a player cannot submit a score as someone else'
);
select lives_ok(
  $$insert into public.replays (payload)
    values ('{"version":3,"seed":7,"mapId":"rls-test","physicsEngine":"wasm-owner","finalScore":5000,"frames":[],"compressedFrames":"60:0,0,0,0,0,0,-;30:1,0,0,0,0,0,-"}')$$,
  'A uploads a replay'
);
select is(
  (select frame_count from public.replays where map_id = 'rls-test'),
  90,
  'the replay frame count is derived from the RLE tape'
);
select lives_ok(
  $$insert into public.saves (schema_version, data) values (2, '{"stage":3}')$$,
  'A writes a save'
);

-- ---------------------------------------------------------------- player B
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","is_anonymous":true}';

select throws_ok(
  $$update public.scores set score = 9999999 where map_id = 'rls-test'$$,
  '42501', null,
  'B cannot update A''s score'
);
select throws_ok(
  $$delete from public.scores where map_id = 'rls-test'$$,
  '42501', null,
  'B cannot delete A''s score'
);
select is(
  (select score from public.scores where map_id = 'rls-test' and name = 'AAA'),
  5000::bigint,
  'A''s score is unchanged'
);
update public.profiles set tag = 'BAD' where id = '00000000-0000-4000-8000-0000000000a1';
select is(
  (select tag from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'),
  null,
  'B cannot set A''s tag'
);
select is(
  (select count(*)::int from public.saves),
  0,
  'B cannot read A''s save'
);
select throws_ok(
  format(
    $$insert into public.scores (name, map_id, score, replay_id) values ('BBB', 'rls-test', 1, %L)$$,
    (select id from public.replays where map_id = 'rls-test')
  ),
  '42501', null,
  'B cannot cite A''s replay'
);

-- Rate limit: five scores a minute.
insert into public.scores (name, map_id, score) values
  ('BBB', 'rls-test', 1), ('BBB', 'rls-test', 2), ('BBB', 'rls-test', 3), ('BBB', 'rls-test', 4), ('BBB', 'rls-test', 5);
select throws_ok(
  $$insert into public.scores (name, map_id, score) values ('BBB', 'rls-test', 6)$$,
  'PT429', null,
  'a sixth score in a minute is refused'
);

-- -------------------------------------------------------------- read paths
select is(
  (select rank from public.leaderboard where map_id = 'rls-test' and name = 'AAA'),
  1,
  'the leaderboard ranks the best score first'
);
select is(
  public.player_rank('rls-test', 3),
  4,
  'player_rank counts the scores above'
);

reset role;
set local role anon;
select throws_ok(
  $$insert into public.scores (name, map_id, score) values ('ANN', 'rls-test', 1)$$,
  '42501', null,
  'a signed-out client cannot submit'
);

select * from finish();
rollback;
