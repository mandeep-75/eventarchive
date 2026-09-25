-- EventArchive — Supabase schema
--
-- Replaces the Firestore rules that were deployed on the old project. The
-- security model is deliberately identical:
--
--   * every signed-in teacher may READ every event, so departments can see each
--     other's work;
--   * only the teacher who created an event may change or delete it;
--   * an event's owning teacher (coordinator_id) and its department are fixed
--     at creation and cannot be changed by a later write;
--   * a teacher may only file a new event under their own department;
--   * only managers curate departments and teacher profiles.
--
-- Run in the Supabase SQL editor, or `supabase db push` for a linked project.

-- ─── Tables ───────────────────────────────────────────────────────────────
-- Order matters: profiles references departments, events references both.

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null,
  email         text not null,
  -- One user type. Manager is a flag, not a role, which is why this is
  -- constrained rather than left as a free-text enum.
  role          text not null default 'teacher' check (role = 'teacher'),
  department_id uuid references public.departments (id) on delete set null,
  is_manager    boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  title             text    not null,
  department_id     uuid    not null references public.departments (id),
  -- Named event_date rather than `date` to stay clear of the type name.
  event_date        date    not null,
  start_time        time    not null,
  end_time          time    not null,
  venue             text    not null,
  description       text    not null default '',
  status            text    not null default 'upcoming'
                      check (status in ('upcoming', 'ongoing', 'completed', 'cancelled')),
  cover_image       text,
  images            text[]  not null default '{}',
  -- Owning teacher. Only the owner may edit, cancel or delete this event.
  coordinator_id    uuid    not null references public.profiles (id),
  cancelled_reason  text    check (cancelled_reason in ('manual', 'no_report')),
  cancelled_at      timestamptz,
  guest_speaker     text,
  participant_count integer,
  report            text,
  report_name       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The events list, calendar and filters all read by date and department.
create index if not exists events_event_date_idx  on public.events (event_date);
create index if not exists events_department_idx  on public.events (department_id);
create index if not exists events_coordinator_idx on public.events (coordinator_id);
create index if not exists profiles_department_idx on public.profiles (department_id);

-- ─── Helpers ──────────────────────────────────────────────────────────────

-- true when the signed-in teacher is a manager.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_manager from public.profiles where id = auth.uid()),
    false
  );
$$;

-- The department a teacher files their events under, from their profile.
create or replace function public.my_department()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select department_id from public.profiles where id = auth.uid();
$$;

-- ─── Row level security ───────────────────────────────────────────────────
-- Every policy below is additive: with RLS on, a table is invisible until at
-- least one policy allows the operation, so these are all permissive grants.

alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.events      enable row level security;

-- Departments: any signed-in teacher reads the list, only managers curate it.
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using (true);

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated with check (public.is_manager());

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists departments_delete on public.departments;
create policy departments_delete on public.departments
  for delete to authenticated using (public.is_manager());

-- Profiles: a teacher may read their own. Listing and editing profiles is
-- manager-only, which is what in-app account provisioning relies on.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_manager());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_manager());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_manager());

-- Events: globally readable, but only the owner writes, and ownership and
-- department are both pinned at creation.
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (true);

-- A teacher files under their own department only, and owns what they file.
-- A teacher with no department gets NULL here, which never equals
-- department_id, so the write is refused rather than filed under nothing.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (
    coordinator_id = auth.uid()
    and department_id = public.my_department()
  );

-- Without this the owner check is enough to update, and an owner could hand the
-- event to another teacher, or re-file it under a department they do not belong
-- to, through an ordinary update. See events_pin_immutable below for why this
-- pinning is a trigger rather than more policy conditions.
drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (coordinator_id = auth.uid())
  with check (coordinator_id = auth.uid());

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated using (coordinator_id = auth.uid());

-- ─── Immutability and bookkeeping ─────────────────────────────────────────
-- Ownership and department are fixed at creation.
--
-- This has to be a trigger, not policy conditions: inside `with check` a
-- reference to public.events resolves to the row being written, so comparing a
-- column against `select … from public.events where id = events.id` compares
-- the new value with itself and always passes. A trigger can see the old row
-- (OLD) and the new row (NEW), which is the only place both are available.
--
-- It also stamps updated_at here, so callers cannot forget to.

create or replace function public.events_pin_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.coordinator_id is distinct from old.coordinator_id then
    raise exception 'coordinator_id is fixed at creation';
  end if;
  if new.department_id is distinct from old.department_id then
    raise exception 'department_id is fixed at creation';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_pin_immutable on public.events;
create trigger events_pin_immutable
  before update on public.events
  for each row execute function public.events_pin_immutable();

-- ─── Fail-closed default ─────────────────────────────────────────────────
-- Every table in the public schema is reachable through Supabase's auto
-- generated REST API. A table created without row level security is therefore
-- readable by anyone holding the anon key, which is the easy mistake to make in
-- the SQL editor and a quiet one to notice.
--
-- This turns that into a fail-closed default: any new table is switched to RLS
-- the moment it is created, and a table with RLS on but no policies is invisible
-- rather than open. It does not grant access — every policy above is still
-- written by hand.
--
-- Scoped to the public schema on purpose: the auth, storage and extensions
-- schemas are managed by Supabase and must not be touched here.

create or replace function public.enable_rls_on_new_public_tables()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  cmd   record;
  found_name text;
begin
  for cmd in
    select d.objid, d.in_extension
    from pg_event_trigger_ddl_commands() as d
    where d.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'CREATE FOREIGN TABLE')
      -- Tables an extension brings along are not ours to secure.
      and not d.in_extension
  loop
    -- Resolved by name and re-quoted, so an odd table name cannot produce an
    -- invalid or injected statement.
    select c.relname into found_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.oid = cmd.objid and n.nspname = 'public';

    if found_name is not null then
      execute format('alter table public.%I enable row level security', found_name);
    end if;
  end loop;
end;
$$;

drop event trigger if exists on_table_created_in_public;
create event trigger on_table_created_in_public
  on ddl_command_end
  execute function public.enable_rls_on_new_public_tables();

-- ─── Realtime ─────────────────────────────────────────────────────────────
-- The app subscribes to events, departments and profiles. Without adding them
-- to the publication, subscriptions connect successfully but never deliver a
-- change, which looks exactly like a broken app.
-- Wrapped in a guard because `alter publication … add table` errors if the
-- table is already a member, which would make the rest of this file
-- unre-runnable and force people to cherry-pick statements after an edit.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'departments') then
    alter publication supabase_realtime add table public.departments;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$$;

-- ─── Storage ──────────────────────────────────────────────────────────────
-- Uploads live at events/{eventId}/{uid}/{folder}/{file}. The uploader's uid
-- is part of the path because storage policies cannot read the events table to
-- check ownership, so the path is what they match on.

insert into storage.buckets (id, name, public, file_size_limit)
values ('event-media', 'event-media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Every signed-in teacher may read every event's media, matching the events
-- select policy above.
drop policy if exists event_media_select on storage.objects;
create policy event_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'event-media');

-- Writes only into the caller's own uid folder.
--
-- Matched with LIKE rather than storage.foldername(name)[n]: foldername returns
-- a 1-INDEXED array (Supabase's own examples use [1] for the first segment), so
-- for events/{eventId}/{uid}/{folder}/{file} the uid is at [3], not [2]. An
-- off-by-one there compares the eventId to the uid and denies every upload. The
-- LIKE form also does not care how deep the path is.
drop policy if exists event_media_insert on storage.objects;
create policy event_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-media'
    and (name like 'events/%/' || auth.uid()::text || '/%')
  );

drop policy if exists event_media_update on storage.objects;
create policy event_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'event-media'
    and (name like 'events/%/' || auth.uid()::text || '/%')
  )
  with check (
    bucket_id = 'event-media'
    and (name like 'events/%/' || auth.uid()::text || '/%')
  );

drop policy if exists event_media_delete on storage.objects;
create policy event_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-media'
    and (name like 'events/%/' || auth.uid()::text || '/%')
  );
