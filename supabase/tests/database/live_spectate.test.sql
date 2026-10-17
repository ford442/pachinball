-- Live spectate (#444 Slice E). Run with `supabase test db` (pgTAP). Player E1
-- streams a run; E2 tries to write into it; anyone reads it. now() is fixed
-- inside the transaction, so the real-time bound allows the 30 s grace only.

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, aud, role, is_anonymous)
values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', true);

create temp table live_run (id uuid) on commit drop;
grant all on live_run to public;

-- A wasm-owner header with its frame-0 snapshot; a full chunk of 300 idle frames.
create temp table fixture (header jsonb, full_chunk text, hash text) on commit drop;
insert into fixture values (
  '{"version":3,"seed":7,"mapId":"neon-helix","physicsEngine":"wasm-owner","initialSnapshot":"AAAA","frames":[1,2],"compressedFrames":"9:0,0,0,0,0,0,-"}',
  '300:0,0,0,0,0,0,-',
  '0123456789abcdef'
);
grant all on fixture to public;

-- ------------------------------------------------------------- start a run
set local role anon;
select throws_ok(
  $$select public.live_start((select header from fixture), 'neon-helix')$$,
  '42501', null, 'anonymous visitors cannot stream'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.live_start('{"physicsEngine":"wasm-worker","initialSnapshot":"AAAA"}', 'neon-helix')$$,
  '22023', null, 'only wasm-owner tapes stream'
);
select throws_ok(
  $$select public.live_start('{"physicsEngine":"wasm-owner"}', 'neon-helix')$$,
  '22023', null, 'a tape without its frame-0 snapshot does not stream'
);
select lives_ok(
  $$insert into live_run select public.live_start((select header from fixture), 'neon-helix', 'ALI', 300, 3)$$,
  'E1 starts a live run'
);
select throws_ok(
  $$select public.prune_replays_live()$$,
  '42501', null, 'pruning is not part of the API'
);
select is(
  (select header ? 'frames' or header ? 'compressedFrames' from public.replays_live where id = (select id from live_run)),
  false,
  'the header keeps no frames'
);

-- ------------------------------------------------------------------ chunks
select is(
  public.live_append((select id from live_run), 0, (select full_chunk from fixture), 300, (select hash from fixture), 120, null, false),
  300,
  'E1 appends chunk 0'
);
select is(
  public.live_append((select id from live_run), 0, (select full_chunk from fixture), 300, (select hash from fixture), 120, null, false),
  300,
  'a resend of a stored chunk is accepted'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 0, (select full_chunk from fixture), 300, 'ffffffffffffffff', 120, null, false)$$,
  'PT409', null, 'a different chunk under a stored seq is refused'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 2, (select full_chunk from fixture), 300, (select hash from fixture), 120, null, false)$$,
  'PT409', null, 'chunks arrive in order'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 1, (select full_chunk from fixture), 299, (select hash from fixture), 120, null, false)$$,
  '22023', null, 'frame_count must match the RLE rows'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 1, '100:0,0,0,0,0,0,-', 100, (select hash from fixture), 120, null, false)$$,
  '22023', null, 'only the final chunk may be short'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 1, '300:0,0,0,0,0,0,-;' || repeat('x', 20000), 300, (select hash from fixture), 120, null, false)$$,
  '23514', null, 'oversized RLE rows are refused'
);
do $$
begin
  for s in 1..5 loop
    perform public.live_append((select id from live_run), s, (select full_chunk from fixture), 300, (select hash from fixture), 120 + s, null, false);
  end loop;
end $$;
select throws_ok(
  $$select public.live_append((select id from live_run), 6, (select full_chunk from fixture), 300, (select hash from fixture), 200, null, false)$$,
  'PT429', null, 'a tape streams no faster than it is played (30 s of grace)'
);

-- -------------------------------------------------------- another player
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.live_append((select id from live_run), 6, '1:0,0,0,0,0,0,-', 1, (select hash from fixture), 9999999, null, true)$$,
  '42501', null, 'E2 cannot write into E1''s run'
);

-- ---------------------------------------------------------------- reading
set local role anon;
select is(
  (select frames from public.live_now where id = (select id from live_run)),
  1800,
  'anyone sees the run live, 1800 frames in'
);
select is(
  (select count(*)::int from public.replays_live_chunks where live_id = (select id from live_run)),
  6,
  'anyone reads its chunks'
);
select is(
  (select player_tag from public.replays_live where id = (select id from live_run)),
  'ALI',
  'with the player''s tag'
);
select throws_ok(
  $$select profile_id from public.replays_live$$,
  '42501', null, 'but not the player''s id'
);

-- ------------------------------------------------------------- ending
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","is_anonymous":true}';
select is(
  public.live_append((select id from live_run), 6, '', 0, (select hash from fixture), 125, null, true),
  1800,
  'an empty final chunk ends the run'
);
select is(
  (select status from public.replays_live where id = (select id from live_run)),
  'ended',
  'the run is over'
);
select is(
  (select count(*)::int from public.live_now where id = (select id from live_run)),
  0,
  'and no longer listed'
);
select throws_ok(
  $$select public.live_append((select id from live_run), 7, (select full_chunk from fixture), 300, (select hash from fixture), 130, null, false)$$,
  'PT409', null, 'nothing appends after the final chunk'
);

-- A new run unlists one that never ended; 30 runs an hour.
select lives_ok(
  $$do $body$
    declare first uuid;
    begin
      first := public.live_start((select header from fixture), 'neon-helix');
      perform public.live_start((select header from fixture), 'neon-helix');
      if (select status from public.replays_live where id = first) <> 'left' then
        raise exception 'the first run is still live';
      end if;
      for i in 1..27 loop perform public.live_start((select header from fixture), 'neon-helix'); end loop;
    end
  $body$
  $$,
  'starting a run unlists the previous one'
);
select throws_ok(
  $$select public.live_start((select header from fixture), 'neon-helix')$$,
  'PT429', null, '30 live runs an hour, then refused'
);

select * from finish();
rollback;
