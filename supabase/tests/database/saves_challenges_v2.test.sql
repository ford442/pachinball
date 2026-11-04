-- Cloud saves across devices, Challenges v2 and the table of the week
-- (#444 Slice D). Run with `supabase test db` (pgTAP). Device A owns a
-- campaign save; device B links to it with a one-time code.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000d3', 'authenticated', 'authenticated', true);

create temp table link_code (code text) on commit drop;
grant all on link_code to public;

-- ---------------------------------------------------------------- device A
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","is_anonymous":true}';
select lives_ok($$insert into public.saves (schema_version, data) values (2, '{"stage":"STORM_LATTICE"}')$$, 'A saves its campaign');
select lives_ok($$insert into link_code select code from public.create_device_link()$$, 'A gets a link code');
select matches((select code from link_code), '^[A-HJ-NP-Z2-9]{8}$', 'the code is 8 unambiguous characters');

-- ---------------------------------------------------------------- device B
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.saves), 0, 'B cannot see A''s save before linking');
select is(public.redeem_device_link('WRONGCOD'), null, 'a wrong code links nothing');
select is(
  public.redeem_device_link(lower((select code from link_code))),
  '00000000-0000-4000-8000-0000000000d1'::uuid,
  'B redeems A''s code (case-insensitive) and saves as A'
);
select is(public.player_id(), '00000000-0000-4000-8000-0000000000d1'::uuid, 'B''s saves are A''s');
select is((select data ->> 'stage' from public.saves where slot = 'campaign'), 'STORM_LATTICE', 'B reads A''s campaign');
select lives_ok(
  $$insert into public.saves (schema_version, data) values (2, '{"stage":"CASINO_HEIST"}')
    on conflict (profile_id, slot) do update set data = excluded.data$$,
  'B writes the shared save'
);
select is(
  (select count(*)::int from public.saves where profile_id = '00000000-0000-4000-8000-0000000000d1'),
  1,
  'one shared save, not two'
);

-- ---------------------------------------------------------------- device C
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d3","role":"authenticated","is_anonymous":true}';
select is(public.redeem_device_link((select code from link_code)), null, 'a used code links nothing');
select is((select count(*)::int from public.saves), 0, 'C still sees only its own (no) saves');
do $$ begin for i in 1..9 loop perform public.redeem_device_link('ZZZZZZZZ'); end loop; end $$;
select throws_ok($$select public.redeem_device_link('ZZZZZZZZ')$$, 'PT429', null, 'ten failed codes an hour, then refused');
do $$ begin for i in 1..5 loop perform public.create_device_link(); end loop; end $$;
select throws_ok($$select * from public.create_device_link()$$, 'PT429', null, 'five link codes an hour, then refused');

-- ---------------------------------------------------------- challenges v2
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","is_anonymous":true}';
insert into public.replays (payload)
values ('{"version":3,"seed":11,"mapId":"neon-helix","physicsEngine":"wasm-owner","finalScore":4000,"compressedFrames":"60:0,0,0,0,0,0,-"}');
select lives_ok(
  $$insert into public.challenges (seed, map_id, target_score, challenger_name, replay_id)
    select 11, 'neon-helix', 4000, 'AAA', id from public.replays where payload ->> 'seed' = '11'$$,
  'A challenges with its own replay'
);
select throws_ok(
  $$insert into public.challenges (seed, map_id, target_score, kind) values (1, 'neon-helix', 1, 'weekly')$$,
  '42501', null, 'a player cannot create a weekly challenge'
);
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$insert into public.challenges (seed, map_id, target_score, replay_id)
    select 11, 'neon-helix', 4000, id from public.replays where payload ->> 'seed' = '11'$$,
  '42501', null, 'B cannot challenge with A''s replay'
);

-- ------------------------------------------------------ table of the week
create temp table weekly on commit drop as select * from public.current_weekly_challenge();
select is(
  (select board from weekly),
  'weekly-' || to_char(now() at time zone 'utc', 'IYYY-"W"IW'),
  'the table of the week has its own board'
);
select is(
  (select (expires_at - starts_at) = interval '7 days' and seed = cascade_seed and starts_at <= now() from weekly),
  true,
  'a seven-day window, one seed for the session and the cascade table'
);
select is(
  (select id from public.current_weekly_challenge()),
  (select id from weekly),
  'asking again returns the same week'
);
select throws_ok(
  $$insert into public.scores (name, map_id, score, challenge_id) select 'BBB', 'neon-helix', 1, id from weekly$$,
  '22023', null, 'a weekly run must go to the week''s board'
);
select lives_ok(
  $$insert into public.scores (name, map_id, score, challenge_id) select 'BBB', board, 1, id from weekly$$,
  'a weekly run on the week''s board is accepted'
);
reset role;

select * from finish();
rollback;
