-- Pachinball live arcade service — core schema (#444 Slice B).
--
-- Contract: docs/API_CONTRACT.md + docs/api/arcade.openapi.yaml.
--
-- Every player is a Supabase anonymous user; `profiles.id` is their auth id.
-- Anyone reads scores, replays and challenges; a player writes only their own
-- rows, and only the columns a client may set — `verified` and the verifier's
-- columns belong to the verifier (service role, Slice C). Saves are private.
-- RLS, column grants, CHECK constraints and rate-limit triggers hold whether a
-- write arrives through an Edge Function or straight at PostgREST.

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Optional three-letter arcade tag (the name-entry dialog's A–Z letters).
  tag text check (tag is null or tag ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per (anonymous) player; id = auth.users.id.';

-- A profile row for every new auth user, so writes can reference it.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------- replays

create table public.replays (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The client's ReplayRecorder.toJSON payload (compressed tape + metadata + frame-0 snapshot).
  payload jsonb not null,
  -- Derived from `payload` by replays_derive (never client-set).
  schema_version int not null,
  seed bigint not null,
  map_id text not null,
  physics_engine text not null,
  snapshot_version int,
  -- World fingerprint: the C++ static-table hash is the table descriptor hash.
  static_hash text,
  feeder_tunables_hash text,
  final_score bigint not null,
  frame_count int not null,
  created_at timestamptz not null default now(),
  constraint replays_payload_size check (octet_length(payload::text) <= 524288),
  constraint replays_frame_count check (frame_count between 0 and 216000)
);

comment on table public.replays is 'Uploaded replay tapes. 512 KB payload cap (MAX_PAYLOAD_SIZE_BYTES); at most one hour of fixed steps.';

-- Total frames of an RLE tape (`count:fields;count:fields…`), or of a raw frames array.
create function public.replay_frame_count(payload jsonb)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(payload ->> 'compressedFrames', '') <> '' then (
      select coalesce(sum(nullif(split_part(run, ':', 1), '')::int), 0)::int
      from unnest(string_to_array(payload ->> 'compressedFrames', ';')) as run
      where run ~ '^[0-9]{1,6}:'
    )
    when jsonb_typeof(payload -> 'frames') = 'array' then jsonb_array_length(payload -> 'frames')
    else 0
  end
$$;

create function public.replays_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.payload) <> 'object' then
    raise exception 'replay payload must be a JSON object' using errcode = '22023';
  end if;
  new.schema_version := coalesce((new.payload ->> 'version')::int, 1);
  new.seed := ((new.payload ->> 'seed')::bigint) & 4294967295;
  new.map_id := left(coalesce(new.payload ->> 'mapId', 'neon-helix'), 64);
  new.physics_engine := left(coalesce(new.payload ->> 'physicsEngine', 'rapier'), 32);
  new.snapshot_version := (new.payload ->> 'snapshotVersion')::int;
  new.static_hash := left(new.payload ->> 'staticHash', 32);
  new.feeder_tunables_hash := left(new.payload ->> 'feederTunablesHash', 32);
  new.final_score := coalesce((new.payload ->> 'finalScore')::bigint, 0);
  new.frame_count := public.replay_frame_count(new.payload);
  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'replay payload has a malformed numeric field' using errcode = '22023';
end;
$$;

create trigger replays_derive
  before insert on public.replays
  for each row execute function public.replays_derive();

-- -------------------------------------------------------------- challenges

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  seed bigint not null check (seed between 0 and 4294967295),
  map_id text not null check (char_length(map_id) between 1 and 64),
  target_score bigint not null check (target_score between 0 and 1000000000000),
  challenger_name text check (challenger_name is null or challenger_name ~ '^[A-Z]{3}$'),
  -- Slice D: the creator's verified run, raced as the ghost.
  replay_id uuid references public.replays (id) on delete set null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint challenges_window check (expires_at is null or expires_at > starts_at)
);

-- ------------------------------------------------------------------ scores

create table public.scores (
  id bigint generated always as identity primary key,
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (name ~ '^[A-Z]{3}$'),
  map_id text not null check (char_length(map_id) between 1 and 64),
  adventure_level text check (adventure_level is null or char_length(adventure_level) between 1 and 64),
  score bigint not null check (score between 0 and 1000000000000),
  balls int not null default 1 check (balls between 0 and 99),
  combo_max int not null default 0 check (combo_max between 0 and 1000000),
  replay_id uuid references public.replays (id) on delete set null,
  challenge_id uuid references public.challenges (id) on delete set null,
  -- Verifier-owned (Slice C): a client can never set these.
  verified boolean not null default false,
  verifier_version text,
  verifier_score bigint,
  verify_reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index scores_board on public.scores (map_id, adventure_level, score desc);
create index scores_profile_recent on public.scores (profile_id, created_at desc);
create index scores_replay on public.scores (replay_id) where replay_id is not null;
create index scores_challenge on public.scores (challenge_id) where challenge_id is not null;
create index replays_profile_recent on public.replays (profile_id, created_at desc);
create index challenges_creator_recent on public.challenges (creator_id, created_at desc);
create index challenges_replay on public.challenges (replay_id) where replay_id is not null;

-- A score may only cite the submitter's own replay.
create function public.scores_check_replay_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.replay_id is not null and not exists (
    select 1 from public.replays r where r.id = new.replay_id and r.profile_id = new.profile_id
  ) then
    raise exception 'replay % is not yours', new.replay_id using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger scores_check_replay_owner
  before insert on public.scores
  for each row execute function public.scores_check_replay_owner();

-- ------------------------------------------------------------------- saves

create table public.saves (
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  slot text not null default 'campaign' check (slot ~ '^[a-z0-9-]{1,32}$'),
  schema_version int not null check (schema_version > 0),
  data jsonb not null check (octet_length(data::text) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (profile_id, slot)
);

create function public.saves_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger saves_touch
  before insert or update on public.saves
  for each row execute function public.saves_touch();

-- -------------------------------------------------------------- rate limits

-- Per-profile insert rate limit: TG_ARGV = (owner column, max rows, window).
create function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_col text := tg_argv[0];
  max_rows int := tg_argv[1]::int;
  win interval := tg_argv[2]::interval;
  owner_id uuid;
  recent int;
begin
  execute format('select ($1).%I', owner_col) into owner_id using new;
  execute format(
    'select count(*) from %I.%I where %I = $1 and created_at > now() - $2',
    tg_table_schema, tg_table_name, owner_col
  ) into recent using owner_id, win;
  if recent >= max_rows then
    -- PTxyz: PostgREST answers with HTTP xyz.
    raise exception 'rate limit: at most % % per %', max_rows, tg_table_name, win
      using errcode = 'PT429';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_rate_limit() from public, anon, authenticated;

create trigger scores_rate_minute before insert on public.scores
  for each row execute function public.enforce_rate_limit('profile_id', '5', '1 minute');
create trigger scores_rate_day before insert on public.scores
  for each row execute function public.enforce_rate_limit('profile_id', '200', '1 day');
create trigger replays_rate_minute before insert on public.replays
  for each row execute function public.enforce_rate_limit('profile_id', '5', '1 minute');
create trigger replays_rate_day before insert on public.replays
  for each row execute function public.enforce_rate_limit('profile_id', '200', '1 day');
create trigger challenges_rate_hour before insert on public.challenges
  for each row execute function public.enforce_rate_limit('creator_id', '20', '1 hour');

-- -------------------------------------------------------- grants and RLS

alter table public.profiles enable row level security;
alter table public.replays enable row level security;
alter table public.challenges enable row level security;
alter table public.scores enable row level security;
alter table public.saves enable row level security;

-- Supabase grants everything on new public tables to anon / authenticated;
-- take it back and grant only what the contract needs, column by column.
revoke all on public.profiles, public.replays, public.challenges, public.scores, public.saves
  from anon, authenticated;

grant select on public.profiles, public.replays, public.challenges, public.scores to anon, authenticated;
grant update (tag) on public.profiles to authenticated;
grant insert (payload) on public.replays to authenticated;
grant insert (seed, map_id, target_score, challenger_name, replay_id) on public.challenges to authenticated;
grant insert (name, map_id, adventure_level, score, balls, combo_max, replay_id, challenge_id)
  on public.scores to authenticated;
-- Upserts set every column they are given, the key included.
grant select, insert (slot, schema_version, data), update (slot, schema_version, data), delete
  on public.saves to authenticated;

-- Public reads.
create policy "profiles are public" on public.profiles
  for select to anon, authenticated using (true);
create policy "replays are public" on public.replays
  for select to anon, authenticated using (true);
create policy "challenges are public" on public.challenges
  for select to anon, authenticated using (true);
create policy "scores are public" on public.scores
  for select to anon, authenticated using (true);

-- Owner writes.
create policy "players set their own tag" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy "players upload their own replays" on public.replays
  for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy "players create their own challenges" on public.challenges
  for insert to authenticated
  with check (creator_id = (select auth.uid()));
create policy "players submit their own scores" on public.scores
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- Saves are private.
create policy "players read their own saves" on public.saves
  for select to authenticated using (profile_id = (select auth.uid()));
create policy "players write their own saves" on public.saves
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "players update their own saves" on public.saves
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy "players delete their own saves" on public.saves
  for delete to authenticated using (profile_id = (select auth.uid()));

-- ------------------------------------------------------------ read surface

-- GET /rest/v1/leaderboard?map_id=eq.<id>&order=rank&limit=10
create view public.leaderboard
with (security_invoker = true)
as
select
  s.id,
  rank() over (
    partition by s.map_id, s.adventure_level
    order by s.score desc, s.created_at asc
  )::int as rank,
  s.name,
  s.score,
  s.map_id,
  s.adventure_level,
  s.balls,
  s.combo_max,
  s.created_at as date,
  s.replay_id,
  s.challenge_id,
  s.verified
from public.scores s;

grant select on public.leaderboard to anon, authenticated;

-- POST /rest/v1/rpc/player_rank { p_map_id, p_score, p_adventure_level }
create function public.player_rank(p_map_id text, p_score bigint, p_adventure_level text default null)
returns int
language sql
stable
set search_path = ''
as $$
  select (count(*) + 1)::int
  from public.scores s
  where s.map_id = p_map_id
    and s.adventure_level is not distinct from p_adventure_level
    and s.score > p_score
$$;

revoke execute on function public.player_rank(text, bigint, text) from public;
grant execute on function public.player_rank(text, bigint, text) to anon, authenticated;

-- Trigger helpers stay out of the API. (replay_frame_count stays callable:
-- replays_derive runs as the inserting player.)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.replays_derive() from public, anon, authenticated;
revoke execute on function public.scores_check_replay_owner() from public, anon, authenticated;
revoke execute on function public.saves_touch() from public, anon, authenticated;
