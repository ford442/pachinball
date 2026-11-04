-- Live spectate (#444 Slice E): open a live run. Rules in docs/API_CONTRACT.md.

-- rpc/live_start → run id. wasm-owner + frame-0 snapshot only; unlists the previous run; 30/hour; prunes.
create function public.live_start(
  p_header jsonb,
  p_map_id text,
  p_tag text default null,
  p_chunk_steps int default 300,
  p_track_stride int default 3
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run_id uuid;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if jsonb_typeof(p_header) is distinct from 'object'
    or p_header ->> 'physicsEngine' is distinct from 'wasm-owner'
    or coalesce(p_header ->> 'initialSnapshot', '') = '' then
    raise exception 'a live run needs a wasm-owner tape header with its frame-0 snapshot' using errcode = '22023';
  end if;
  if (select count(*) from public.replays_live r where r.profile_id = uid and r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate limit: at most 30 live runs an hour' using errcode = 'PT429';
  end if;
  perform public.prune_replays_live();
  update public.replays_live r set status = 'left' where r.profile_id = uid and r.status = 'live';
  insert into public.replays_live (profile_id, header, map_id, player_tag, chunk_steps, track_stride)
  values (uid, p_header - 'frames' - 'compressedFrames', p_map_id, p_tag, p_chunk_steps, p_track_stride)
  returning id into run_id;
  return run_id;
end;
$$;

revoke execute on function public.live_start(jsonb, text, text, int, int) from public, anon;
grant execute on function public.live_start(jsonb, text, text, int, int) to authenticated;
