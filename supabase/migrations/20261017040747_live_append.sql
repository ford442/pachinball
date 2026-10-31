-- Live spectate (#444 Slice E): append a chunk. Rules in docs/API_CONTRACT.md.

-- rpc/live_append → frames so far. In order; full until the final chunk; resends accepted; real time + 30 s.
create function public.live_append(
  p_live_id uuid,
  p_seq int,
  p_frames text,
  p_frame_count int,
  p_state_hash text,
  p_score bigint,
  p_track text default null,
  p_final boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run public.replays_live;
  stored public.replays_live_chunks;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into run from public.replays_live r where r.id = p_live_id for update;
  if run.id is null or run.profile_id <> uid then
    raise exception 'no such live run of yours' using errcode = '42501';
  end if;
  if p_seq < run.chunks then
    select * into stored from public.replays_live_chunks c where c.live_id = p_live_id and c.seq = p_seq;
    if stored.frame_count = p_frame_count and stored.state_hash = p_state_hash and stored.final = p_final then
      return run.frames;
    end if;
    raise exception 'chunk % is already stored, differently', p_seq using errcode = 'PT409';
  end if;
  if run.status = 'ended' then
    raise exception 'this live run has ended' using errcode = 'PT409';
  end if;
  if p_seq <> run.chunks then
    raise exception 'chunks arrive in order: expected %, got %', run.chunks, p_seq using errcode = 'PT409';
  end if;
  if p_frame_count is null or p_frame_count <> public.replay_frame_count(jsonb_build_object('compressedFrames', p_frames)) then
    raise exception 'frame_count does not match the RLE rows' using errcode = '22023';
  end if;
  if (not p_final and p_frame_count <> run.chunk_steps) or p_frame_count > run.chunk_steps then
    raise exception 'a chunk is % frames (the final one at most)', run.chunk_steps using errcode = '22023';
  end if;
  if run.frames + p_frame_count > floor(extract(epoch from now() - run.created_at) * 60) + 1800 then
    raise exception 'rate limit: a live tape streams at most as fast as it is played' using errcode = 'PT429';
  end if;
  insert into public.replays_live_chunks (live_id, seq, start_frame, frame_count, frames, state_hash, score, track, final)
  values (p_live_id, p_seq, run.frames, p_frame_count, p_frames, p_state_hash, p_score, p_track, p_final);
  update public.replays_live r
  set chunks = r.chunks + 1,
      frames = r.frames + p_frame_count,
      score = p_score,
      status = case when p_final then 'ended' else r.status end,
      updated_at = now()
  where r.id = p_live_id;
  return run.frames + p_frame_count;
end;
$$;

revoke execute on function public.live_append(uuid, int, text, int, text, bigint, text, boolean) from public, anon;
grant execute on function public.live_append(uuid, int, text, int, text, bigint, text, boolean) to authenticated;
