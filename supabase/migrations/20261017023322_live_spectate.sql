-- Live spectate (#444 Slice E). Contract: docs/API_CONTRACT.md.
--
-- A player who opted in streams each run's tape while they play it: the
-- frame-0 header once (live_start), then one chunk of fixed steps at a time
-- (live_append), each with the C++ state hash and score after its last step
-- and the ball's path over it. Spectators poll the chunks and replay them.
-- Anyone reads; only the two functions write, as the calling player.

create table public.replays_live (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- ReplayRecorder metadata at frame 0 (seed, table, cascade, build, engine,
  -- world fingerprint and frame-0 snapshot); the frames come as chunks.
  header jsonb not null,
  map_id text not null check (char_length(map_id) between 1 and 64),
  player_tag text check (player_tag is null or player_tag ~ '^[A-Z]{3}$'),
  chunk_steps int not null check (chunk_steps between 60 and 600),
  track_stride int not null check (track_stride between 1 and 10),
  chunks int not null default 0,
  frames int not null default 0 check (frames between 0 and 216000),
  score bigint not null default 0 check (score between 0 and 1000000000000),
  -- live: streaming · left: the player started another run (no longer listed;
  -- its last chunks may still land) · ended: its final chunk is stored.
  status text not null default 'live' check (status in ('live', 'left', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint replays_live_header_size check (octet_length(header::text) <= 65536)
);

comment on table public.replays_live is 'Runs streaming to spectators (#444 Slice E); pruned a day after their last chunk.';

create index replays_live_now on public.replays_live (updated_at desc) where status = 'live';
create index replays_live_updated on public.replays_live (updated_at);
create index replays_live_profile_recent on public.replays_live (profile_id, created_at desc);

create table public.replays_live_chunks (
  live_id uuid not null references public.replays_live (id) on delete cascade,
  seq int not null check (seq between 0 and 3600),
  start_frame int not null check (start_frame between 0 and 216000),
  frame_count int not null check (frame_count between 0 and 600),
  -- RLE rows (compressInputFrames) for frames [start_frame, start_frame + frame_count).
  frames text not null,
  -- After the chunk's last step: what a spectator replaying it must reach.
  state_hash text not null check (state_hash ~ '^[0-9a-f]{16}$'),
  score bigint not null check (score between 0 and 1000000000000),
  -- The primary ball's path: base64 Int32 millimetre triples, one every track_stride steps.
  track text,
  final boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (live_id, seq),
  -- At most ~48 bytes of RLE per frame, and 16 base64 characters per path sample.
  constraint replays_live_chunks_frames_size check (octet_length(frames) <= 48 * frame_count + 64),
  constraint replays_live_chunks_track_size check (track is null or octet_length(track) <= 16 * (frame_count + 1) + 16)
);

comment on table public.replays_live_chunks is 'The streamed tape of a live run, one chunk of fixed steps per row.';

alter table public.replays_live enable row level security;
alter table public.replays_live_chunks enable row level security;
revoke all on public.replays_live, public.replays_live_chunks from anon, authenticated;

-- Public reads, without the player's id.
grant select (id, header, map_id, player_tag, chunk_steps, track_stride, chunks, frames, score, status, created_at, updated_at)
  on public.replays_live to anon, authenticated;
grant select on public.replays_live_chunks to anon, authenticated;
create policy "live runs are public" on public.replays_live
  for select to anon, authenticated using (true);
create policy "live chunks are public" on public.replays_live_chunks
  for select to anon, authenticated using (true);

-- GET /rest/v1/live_now: runs that sent something in the last 45 seconds.
create view public.live_now
with (security_invoker = true)
as
select id, map_id, player_tag, chunk_steps, track_stride, chunks, frames, score, status, created_at, updated_at
from public.replays_live
where status = 'live' and updated_at > now() - interval '45 seconds';

grant select on public.live_now to anon, authenticated;

-- The writes: live_start and live_append (their own migrations, after this one).
