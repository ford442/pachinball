-- Live spectate (#444 Slice E): live runs are kept a day after their last
-- chunk. live_start prunes (at most 200 runs a call); not part of the API.
create function public.prune_replays_live()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.replays_live r
  where r.id in (select o.id from public.replays_live o where o.updated_at < now() - interval '1 day' limit 200)
$$;

revoke execute on function public.prune_replays_live() from public, anon, authenticated;
