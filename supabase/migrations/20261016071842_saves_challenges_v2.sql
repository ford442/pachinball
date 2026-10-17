-- Cloud saves across devices, Challenges v2, the table of the week and race
-- ghosts (#444 Slice D). Contract: docs/API_CONTRACT.md.

-- ------------------------------------------------------------ device links
--
-- Players are anonymous per browser. A one-time code links another device to
-- a player: the linked device reads and writes that player's saves
-- (`player_id()`). Scores stay with the device that played them.

alter table public.profiles
  add column linked_to uuid references public.profiles (id) on delete set null,
  add constraint profiles_not_self_linked check (linked_to is null or linked_to <> id);

-- The player whose saves the caller owns: the device it is linked to, or itself.
create function public.player_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce((select p.linked_to from public.profiles p where p.id = auth.uid()), auth.uid())
$$;

grant execute on function public.player_id() to anon, authenticated;

alter table public.saves alter column profile_id set default public.player_id();

drop policy "players read their own saves" on public.saves;
drop policy "players write their own saves" on public.saves;
drop policy "players update their own saves" on public.saves;
drop policy "players delete their own saves" on public.saves;
create policy "players read their own saves" on public.saves
  for select to authenticated using (profile_id = (select public.player_id()));
create policy "players write their own saves" on public.saves
  for insert to authenticated with check (profile_id = (select public.player_id()));
create policy "players update their own saves" on public.saves
  for update to authenticated
  using (profile_id = (select public.player_id()))
  with check (profile_id = (select public.player_id()));
create policy "players delete their own saves" on public.saves
  for delete to authenticated using (profile_id = (select public.player_id()));

create table public.device_links (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  player_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  redeemed_by uuid references public.profiles (id) on delete set null,
  redeemed_at timestamptz
);

create index device_links_creator_recent on public.device_links (created_by, created_at desc);
create index device_links_player on public.device_links (player_id);
create index device_links_redeemer on public.device_links (redeemed_by) where redeemed_by is not null;

-- Failed redemptions, for the brute-force limit.
create table public.device_link_attempts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index device_link_attempts_recent on public.device_link_attempts (profile_id, attempted_at desc);

-- Reached only through the two functions below.
alter table public.device_links enable row level security;
alter table public.device_link_attempts enable row level security;
revoke all on public.device_links, public.device_link_attempts from anon, authenticated;

-- POST /rest/v1/rpc/create_device_link → { code, expires_at }: 8 characters
-- from a 32-symbol alphabet without 0/O/1/I, valid 10 minutes, 5 an hour.
create function public.create_device_link()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  candidate text;
  i int;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.device_links d where d.created_by = uid and d.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate limit: at most 5 link codes an hour' using errcode = 'PT429';
  end if;
  loop
    bytes := extensions.gen_random_bytes(8);
    candidate := '';
    for i in 0..7 loop
      candidate := candidate || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.device_links d where d.code = candidate);
  end loop;
  insert into public.device_links (code, player_id, created_by)
  values (candidate, public.player_id(), uid);
  return query select candidate, now() + interval '10 minutes';
end;
$$;

-- POST /rest/v1/rpc/redeem_device_link { p_code } → the player this device
-- now saves as, or null for an unknown / used / expired code (10 failed
-- tries an hour). Devices already linked to the caller follow it.
create function public.redeem_device_link(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target uuid;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.device_link_attempts a where a.profile_id = uid and a.attempted_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limit: at most 10 failed link codes an hour' using errcode = 'PT429';
  end if;
  select d.player_id into target
  from public.device_links d
  where d.code = upper(trim(p_code)) and d.redeemed_by is null and d.expires_at > now()
  for update;
  if target is null then
    insert into public.device_link_attempts (profile_id) values (uid);
    return null;
  end if;
  update public.device_links set redeemed_by = uid, redeemed_at = now() where code = upper(trim(p_code));
  if target <> uid then
    update public.profiles set linked_to = target where id = uid or linked_to = uid;
  end if;
  return target;
end;
$$;

revoke execute on function public.create_device_link() from public, anon;
revoke execute on function public.redeem_device_link(text) from public, anon;
grant execute on function public.create_device_link() to authenticated;
grant execute on function public.redeem_device_link(text) to authenticated;

-- ---------------------------------------------------------- challenges v2

alter table public.challenges
  add column kind text not null default 'player' check (kind in ('player', 'weekly')),
  -- The leaderboard map_id this challenge's runs submit to (weekly: its own board).
  add column board text check (board is null or char_length(board) between 1 and 64),
  -- The cascade table it is played on (free seed); null for the vanilla table.
  add column cascade_seed bigint check (cascade_seed between 0 and 4294967295),
  add column title text check (title is null or char_length(title) <= 80);

alter table public.challenges alter column creator_id drop not null;
alter table public.challenges add constraint challenges_have_creator check (kind = 'weekly' or creator_id is not null);
create unique index challenges_weekly_board on public.challenges (board) where kind = 'weekly';

grant insert (cascade_seed) on public.challenges to authenticated;

-- A player's challenge may only cite the creator's own replay.
create function public.challenges_check_replay_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.replay_id is not null and not exists (
    select 1 from public.replays r where r.id = new.replay_id and r.profile_id = new.creator_id
  ) then
    raise exception 'replay % is not yours', new.replay_id using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger challenges_check_replay_owner
  before insert on public.challenges
  for each row when (new.kind = 'player')
  execute function public.challenges_check_replay_owner();

revoke execute on function public.challenges_check_replay_owner() from public, anon, authenticated;

-- POST /rest/v1/rpc/current_weekly_challenge → this ISO week's table of the
-- week, created on first ask: a free-cascade table and session seed derived
-- from the week, Monday 00:00 UTC for seven days, board `weekly-<week>`.
create function public.current_weekly_challenge()
returns setof public.challenges
language plpgsql
security definer
set search_path = ''
as $$
declare
  week text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  week_start timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  week_seed bigint := ('x' || lpad(substr(md5('pachinball-weekly-' || week), 1, 8), 16, '0'))::bit(64)::bigint;
begin
  insert into public.challenges (kind, board, seed, cascade_seed, map_id, target_score, starts_at, expires_at, title)
  values ('weekly', 'weekly-' || week, week_seed, week_seed, 'neon-helix', 0,
          week_start, week_start + interval '7 days', 'Table of the week ' || week)
  on conflict (board) where kind = 'weekly' do nothing;
  return query select * from public.challenges c where c.kind = 'weekly' and c.board = 'weekly-' || week;
end;
$$;

revoke execute on function public.current_weekly_challenge() from public;
grant execute on function public.current_weekly_challenge() to anon, authenticated;

-- A weekly run is submitted to the week's board, inside the week.
create function public.scores_check_challenge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ch record;
begin
  if new.challenge_id is null then
    return new;
  end if;
  select c.kind, c.board, c.starts_at, c.expires_at into ch from public.challenges c where c.id = new.challenge_id;
  if ch.kind = 'weekly' and (new.map_id is distinct from ch.board or now() < ch.starts_at or now() > ch.expires_at) then
    raise exception 'not a run of this week''s challenge (board %, % to %)', ch.board, ch.starts_at, ch.expires_at
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger scores_check_challenge
  before insert on public.scores
  for each row execute function public.scores_check_challenge();

revoke execute on function public.scores_check_challenge() from public, anon, authenticated;

-- ------------------------------------------------------------ race ghosts
--
-- The ball's path through a verified run, recorded by the replay verifier
-- while it replays the tape (never uploaded by a client): the ghost a
-- challenged player races.

create table public.ghost_tracks (
  replay_id uuid primary key references public.replays (id) on delete cascade,
  -- One sample every `stride` fixed steps from frame 0.
  stride int not null check (stride between 1 and 60),
  samples int not null check (samples >= 0),
  -- Base64 of little-endian Int32 millimetre triples (x, y, z) of the primary ball.
  track text not null check (octet_length(track) <= 1048576),
  verifier_version text,
  created_at timestamptz not null default now()
);

alter table public.ghost_tracks enable row level security;
revoke all on public.ghost_tracks from anon, authenticated;
grant select on public.ghost_tracks to anon, authenticated;
create policy "ghost tracks are public" on public.ghost_tracks
  for select to anon, authenticated using (true);

-- ----------------------------------------------- verifier sees the challenge

drop function public.claim_score_verifications(int, interval);

create function public.claim_score_verifications(p_limit int default 4, p_stale interval default '15 minutes')
returns table (
  score_id bigint,
  score bigint,
  map_id text,
  replay_id uuid,
  payload jsonb,
  physics_engine text,
  attempts int,
  submitted_at timestamptz,
  challenge_id uuid,
  challenge_kind text,
  challenge_seed bigint,
  challenge_cascade_seed bigint,
  challenge_board text,
  challenge_starts_at timestamptz,
  challenge_expires_at timestamptz
)
language sql
set search_path = ''
as $$
  with picked as (
    select s.id
    from public.scores s
    where not s.verified
      and s.verify_reason is null
      and (s.verify_claimed_at is null or s.verify_claimed_at < now() - p_stale)
    order by s.created_at
    limit greatest(1, least(p_limit, 32))
    for update skip locked
  ),
  claimed as (
    update public.scores s
    set verify_claimed_at = now(), verify_attempts = s.verify_attempts + 1
    from picked
    where s.id = picked.id
    returning s.id, s.score, s.map_id, s.replay_id, s.challenge_id, s.verify_attempts, s.created_at
  )
  select c.id, c.score, c.map_id, c.replay_id, r.payload, r.physics_engine, c.verify_attempts, c.created_at,
         c.challenge_id, ch.kind, ch.seed, ch.cascade_seed, ch.board, ch.starts_at, ch.expires_at
  from claimed c
  left join public.replays r on r.id = c.replay_id
  left join public.challenges ch on ch.id = c.challenge_id
  order by c.created_at
$$;

revoke execute on function public.claim_score_verifications(int, interval) from public, anon, authenticated;
grant execute on function public.claim_score_verifications(int, interval) to service_role;
