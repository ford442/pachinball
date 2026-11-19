-- Machines that play differently (#556 Slice 1): every run names its rules,
-- and a board is (map_id, rules_hash). Run with `supabase test db` (pgTAP).

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- The legacy vanilla rules (LEGACY_RULES_HASH) and two machines' rules.
create temp table h (name text primary key, hash text) on commit drop;
insert into h values
  ('legacy', 'a46a08bbeb7d6b2db2e5bf5c43f16347343b10a89e82a50e60c8958b3edb8528'),
  ('fire', repeat('f', 64)),
  ('ice', repeat('1', 64));
grant select on h to authenticated, service_role;

select has_column('public', 'replays', 'rules_hash', 'replays name their rules');
select has_column('public', 'scores', 'rules_hash', 'scores name their rules');
select has_column('public', 'challenges', 'rules_hash', 'challenges name their rules');
select has_index('public', 'scores', 'scores_board', array['map_id', 'rules_hash', 'adventure_level', 'score'], 'the board index leads with (map_id, rules_hash)');

insert into auth.users (id, aud, role, is_anonymous)
values ('00000000-0000-4000-8000-0000000000f6', 'authenticated', 'authenticated', true);

-- Replays: schema 4 names its rules; older tapes played the legacy vanilla rules.
-- Seeded as the table owner (a player inserts only the payload).
insert into public.replays (id, profile_id, payload) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000f6',
   jsonb_build_object('version', 4, 'seed', 1, 'mapId', 'rules-test', 'finalScore', 500, 'compressedFrames', '60:0,0,0,0,0,0,-',
                      'rulesHash', (select hash from h where name = 'fire'))),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000f6',
   '{"version":3,"seed":2,"mapId":"rules-test","finalScore":400,"compressedFrames":"60:0,0,0,0,0,0,-"}');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f6","role":"authenticated","is_anonymous":true}';

select is((select rules_hash from public.replays where id = '00000000-0000-4000-8000-00000000a001'),
          (select hash from h where name = 'fire'), 'a schema 4 replay keeps the rules hash it names');
select is((select rules_hash from public.replays where id = '00000000-0000-4000-8000-00000000a002'),
          (select hash from h where name = 'legacy'), 'a schema 3 replay reads as the legacy vanilla rules');
select throws_ok(
  $$insert into public.replays (payload) values ('{"version":4,"seed":3,"mapId":"rules-test","compressedFrames":"1:0,0,0,0,0,0,-"}')$$,
  '22023', null, 'a schema 4 replay without a rules hash is refused'
);
select throws_ok(
  $$insert into public.replays (payload) values ('{"version":4,"seed":3,"mapId":"rules-test","rulesHash":"not-a-hash","compressedFrames":"1:0,0,0,0,0,0,-"}')$$,
  '22023', null, 'and so is one with a malformed hash'
);

-- Scores: a score names its replay's rules.
select throws_ok(
  $$insert into public.scores (name, map_id, score, replay_id, rules_hash)
    values ('BAD', 'rules-test', 500, '00000000-0000-4000-8000-00000000a001', (select hash from h where name = 'ice'))$$,
  '22023', null, 'a score naming other rules than its replay''s is refused'
);
select throws_ok(
  $$insert into public.scores (name, map_id, score, replay_id)
    values ('OLD', 'rules-test', 500, '00000000-0000-4000-8000-00000000a001')$$,
  '22023', null, 'and one naming none (the legacy default) for a machine''s replay'
);
select lives_ok(
  $$insert into public.scores (name, map_id, score, replay_id, rules_hash)
    values ('FIR', 'rules-test', 500, '00000000-0000-4000-8000-00000000a001', (select hash from h where name = 'fire'))$$,
  'a score naming its replay''s rules is stored'
);
select lives_ok(
  $$insert into public.scores (name, map_id, score, replay_id)
    values ('VAN', 'rules-test', 400, '00000000-0000-4000-8000-00000000a002')$$,
  'an older client''s score on an older tape needs no hash'
);
insert into public.scores (name, map_id, score, rules_hash)
  values ('VNB', 'rules-test', 300, (select hash from h where name = 'legacy')),
         ('ICE', 'rules-test', 900, (select hash from h where name = 'ice'));

-- Boards: the same table under other rules is another board.
select results_eq(
  $$select name, rank from public.leaderboard where map_id = 'rules-test' and rules_hash = (select hash from h where name = 'legacy') order by rank$$,
  $$values ('VAN', 1), ('VNB', 2)$$,
  'the vanilla board ranks vanilla runs only'
);
select results_eq(
  $$select name, rank from public.leaderboard where map_id = 'rules-test' and rules_hash = (select hash from h where name = 'fire') order by rank$$,
  $$values ('FIR', 1)$$,
  'a machine''s board ranks its own runs'
);
select is(
  (select count(*)::int from public.leaderboard where map_id = 'rules-test' and rank = 1),
  3, 'one leader per (map, rules)'
);
select is(public.player_rank('rules-test', 350), 2, 'player_rank defaults to the legacy vanilla board');
select is(public.player_rank('rules-test', 350, null, (select hash from h where name = 'ice')), 2, 'and ranks on the board it is given');
select is(public.player_rank('rules-test', 950, null, (select hash from h where name = 'fire')), 1, 'a score above every run on its board is first');

-- Challenges: a player's challenge plays its replay's rules.
insert into public.challenges (seed, map_id, target_score, replay_id)
values (1, 'rules-test', 500, '00000000-0000-4000-8000-00000000a001');
create temp table ch on commit drop as select id from public.challenges where map_id = 'rules-test';
grant select on ch to authenticated, service_role;
select is((select rules_hash from public.challenges where id = (select id from ch)),
          (select hash from h where name = 'fire'), 'a challenge takes its replay''s rules');
select throws_ok(
  $$insert into public.scores (name, map_id, score, challenge_id) values ('CHV', 'rules-test', 10, (select id from ch))$$,
  '22023', null, 'a challenge run under other rules is refused'
);
select lives_ok(
  $$insert into public.scores (name, map_id, score, challenge_id, rules_hash)
    values ('CHF', 'rules-test', 10, (select id from ch), (select hash from h where name = 'fire'))$$,
  'a challenge run under its rules is stored'
);
reset role;

-- The verifier sees the rules the score names and its challenge's.
set local role service_role;
create temp table claimed on commit drop as select * from public.claim_score_verifications(32);
select is(
  (select rules_hash from claimed where challenge_id = (select id from ch)),
  (select hash from h where name = 'fire'), 'a claim carries the score''s rules hash'
);
select is(
  (select challenge_rules_hash from claimed where challenge_id = (select id from ch)),
  (select hash from h where name = 'fire'), 'and its challenge''s'
);
reset role;

select * from finish();
rollback;
