-- EventArchive — Supabase schema
--
-- Replaces the Firestore rules that were deployed on the old project. The
-- security model is deliberately identical:
--
--   * every signed-in teacher may READ every event, so departments can see each
--     other's work;
--   * an event may be changed or deleted by any teacher in the department it
--     belongs to, not only by the teacher who created it;
--   * an event's owning teacher (coordinator_id) and its department are fixed
--     at creation and cannot be changed by a later write;
--   * a teacher may only file a new event under their own department;
--   * only managers curate departments and teacher profiles;
--   * every signed-in teacher may upload an event's photos and report, but only
--     managers may read them back — see the storage section.
--
-- Run in the Supabase SQL editor, or `supabase db push` for a linked project.

-- ─── Tables ───────────────────────────────────────────────────────────────
-- Order matters: profiles references departments, events references both.
--
-- To wipe the data and rebuild from this file, run supabase/reset.sql first —
-- the drop is kept out of here on purpose, because this file is pasted on every
-- column change and an unconditional drop would take every event with it.


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

-- Rebuild a profile for every account that does not have one.
--
-- Profiles are created by the create-teacher edge function, not by a trigger on
-- auth.users, so nothing will put them back on its own. Without this, anyone
-- whose profile row was dropped is left signed in with no profile at all, and
-- since is_manager() and my_department() both read this table, they answer
-- null: the account is refused everywhere, with nothing on screen to explain
-- why. Departments are gone too after a reset, so everyone comes back
-- unassigned and a manager has to place them.
--
-- Idempotent, and a no-op on a project where every account already has a
-- profile: `on conflict do nothing` means a routine paste cannot overwrite a
-- name, a role or a department that a manager has already set.
insert into public.profiles (id, name, email)
select
  u.id,
  -- full_name is what the sign-up form stores; fall back to the local part of
  -- the address so the not-null check cannot be the thing that fails.
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Teacher'
  ),
  coalesce(u.email, u.id::text)
from auth.users u
on conflict (id) do nothing;

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
  -- There is deliberately no status column. Whether an event is upcoming,
  -- ongoing or over is decided from event_date, start_time and end_time
  -- against the clock, every time the event is shown (see
  -- src/lib/eventStatus.ts). A stored status was the source of a long bug: it
  -- had to be written by something, the only thing that could was a browser,
  -- and a browser can only update its own teacher's rows — so events other
  -- people owned sat on 'upcoming' long after they finished. With nothing
  -- stored there is nothing to fall out of step.
  cover_image       text,
  images            text[]  not null default '{}',
  -- Owning teacher. Editing, cancelling and deleting belong to the department,
  -- but this is who filed it and who it is credited to.
  coordinator_id    uuid    not null references public.profiles (id),
  -- The owner's display name, copied here once, at creation.
  --
  -- Denormalised on purpose. Showing "Created by" needs the name, and the
  -- profiles_select policy only lets a manager read anyone's row — so a teacher
  -- filing an event for a colleague would be impossible without either
  -- exposing every teacher's name and email to every signed-in user, or
  -- denormalising it. A column the caller cannot set is the smaller of the two.
  coordinator_name  text,
  -- Set only when a teacher cancels an event by hand, which is sticky. The
  -- other reason, 'no_report', is worked out from the dates rather than
  -- stored, so it is never written here.
  cancelled_reason  text    check (cancelled_reason in ('manual', 'no_report')),
  cancelled_at      timestamptz,
  guest_speaker     text,
  -- Kept so rows created before the field left the form still read correctly,
  -- and so the column is there if it ever comes back. Nothing writes it now;
  -- the form no longer collects a count.
  participant_count integer,
  report            text,
  report_name       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- For a database created before status was dropped. `create table if not exists`
-- leaves an existing table alone, so without this the column would survive and
-- go on being written. The drop also removes the check constraint that came with
-- it. Any rows cancelled for a missing report keep their 'no_report' reason; it
-- is ignored now, because that state is worked out from the dates instead.
alter table public.events drop column if exists status;

-- Same reason as the drop above: a table that already exists skips the
-- definition above, so a column added to the file never reaches an existing
-- project on its own.
alter table public.events add column if not exists coordinator_name text;

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

-- The caller's own display name, for the same reason as the two above: it only
-- ever answers about the caller, so a security definer that reads one row of the
-- profiles table is not a way to read anyone else's.
--
-- This exists because profiles_select only lets a teacher read their own row, so
-- "who created this" is not answerable from the client. Events copy the name in
-- at creation instead of widening that policy.
create or replace function public.my_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select name from public.profiles where id = auth.uid();
$$;

revoke execute on function public.my_name() from public, anon;
grant execute on function public.my_name() to authenticated;

-- ─── Row level security ───────────────────────────────────────────────────
-- Every policy below is additive: with RLS on, a table is invisible until at
-- least one policy allows the operation, so these are all permissive grants.

alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.events      enable row level security;

-- Table privileges, stated rather than inherited.
--
-- A table created by the reset above is brand new, and a new table has no
-- grants. Supabase papers over this with ALTER DEFAULT PRIVILEGES, but that is a
-- property of the project, not of this file — and the failure it causes is the
-- quiet kind: RLS is on, every policy above is correct, and every request comes
-- back "permission denied for table events" with nothing in the app to explain
-- it. GRANT is idempotent, so stating it here also means this file no longer
-- depends on the project having been set up a particular way.
--
-- anon is granted too, on purpose. PostgREST answers an unprivileged request as
-- an empty set rather than an error, which is what the app expects before
-- sign-in; no privilege at all turns every signed-out page load into an error.
-- RLS is what decides visibility — the policies above are the only thing letting
-- anything through, and they all require a signed-in user.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

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
-- Editing is a department permission, not a personal one: any teacher in the
-- owning department can change or delete the event. A colleague covering for
-- whoever filed it should not be locked out, and the archive is organised by
-- department anyway.
--
-- The with check is what stops an event being moved out from under the
-- department that owns it. `using` alone would not: a row is visible to this
-- policy while it is in the caller's department, and a teacher could then
-- rewrite department_id to a department they do not belong to and keep writing
-- to it. Both halves name my_department() for that reason.
--
-- coordinator_id is not mentioned here, so it is deliberately left writable to
-- the department — see events_pin_immutable below, which is what actually
-- prevents handing an event to another teacher, and why that cannot be done in
-- policy conditions.
drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (department_id = public.my_department())
  with check (department_id = public.my_department());

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated
  using (department_id = public.my_department());

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
  -- The credit belongs to whoever filed the event, and this trigger is already
  -- the one place that says "not yours to change". Without the check here, the
  -- events_update policy would let any teacher in the department rewrite who an
  -- archived event is credited to.
  --
  -- A name that is still missing may be filled in, because the backfill further
  -- down has to credit events that predate the column. A name that is already
  -- there is history and stays where it is.
  if old.coordinator_name is not null
     and new.coordinator_name is distinct from old.coordinator_name then
    raise exception 'coordinator_name is fixed at creation';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_pin_immutable on public.events;
create trigger events_pin_immutable
  before update on public.events
  for each row execute function public.events_pin_immutable();

-- Stamp the creator's name on the way in.
--
-- Set in a trigger rather than by the app so the value cannot be forged: the
-- events_insert policy already requires coordinator_id = auth.uid(), and
-- coordinator_id is pinned by events_pin_immutable, so the caller's own name is
-- the only name that can land here. A client sending coordinator_name — or
-- sending someone else's — is overwritten rather than obeyed.
--
-- security definer because profiles_select does not let a teacher read their own
-- row from a trigger's point of view either; without it the lookup would come
-- back NULL for exactly the people allowed to file events.
--
-- Insert-only, deliberately. events_pin_immutable raises on a change to
-- coordinator_id, and the name is a snapshot of who filed it at that moment —
-- an archive that keeps the name as it stood is worth more than one that
-- silently rewrites history when someone is renamed.
create or replace function public.events_stamp_coordinator_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.coordinator_name := public.my_name();
  return new;
end;
$$;

drop trigger if exists events_stamp_coordinator_name on public.events;
create trigger events_stamp_coordinator_name
  before insert on public.events
  for each row execute function public.events_stamp_coordinator_name();

-- Fill in the name for events that predate the column, so a project that has
-- been running does not show a blank creator on everything it already holds.
-- Only where it is null, so this cannot undo the name a trigger already stamped.
update public.events e
set coordinator_name = p.name
from public.profiles p
where p.id = e.coordinator_id
  and e.coordinator_name is null;

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
-- Uploads live at events/{eventId}/{uid}/{folder}/{file}.
--
-- The uid stays in the path so a teacher's own folder is always writable, but it
-- is no longer the only thing that grants access: the department that owns the
-- event can manage its media too. That has to match the events_update policy,
-- or a teacher could edit an event's date and venue but be refused when
-- replacing its cover photo or filing its report.

insert into storage.buckets (id, name, public, file_size_limit)
values ('event-media', 'event-media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Photos and reports are read by managers only, and this is the whole boundary:
-- a signed URL is minted only for a caller the select policy lets see the
-- object, so a teacher who uploads a cover cannot open it again afterwards.
-- Writing is deliberately wider than reading. Filing the media is part of
-- running an event and stays with the department that owns it; looking through
-- what was filed is the review, and that is a manager's job.
--
-- Note this is stricter than events_select above. Any teacher may read the
-- event's own row — title, date, venue, and the media *paths* — because an
-- archive nobody outside their department can read is not an archive. The paths
-- are useless without a signature, and this policy is what refuses one.
--
-- One consequence is not obvious and costs a bug to rediscover: Postgres applies
-- this policy to a DELETE with a WHERE clause and to
-- `insert … on conflict do update` as well. So for a non-manager the insert
-- policy below is the only write that can land — replacing or removing an
-- existing object is refused even though the update and delete policies name the
-- caller's department. That is why no upload path is ever reused: the app stamps
-- every file name, so replacing a photo is a fresh insert rather than an
-- overwrite. Widening this policy to let a teacher overwrite a file would also
-- let them mint a signed URL for it, which is the one thing it exists to stop.
drop policy if exists event_media_select on storage.objects;
create policy event_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'event-media' and public.is_manager());

-- True when the object sits under an event in the caller's own department.
--
-- The event id is compared as text rather than cast to uuid on purpose. The path
-- is attacker-controlled, so `split_part(...)::uuid` raises invalid_input_syntax
-- on anything that is not a uuid and takes the whole statement down with it —
-- including legitimate requests for paths that are simply not events. Comparing
-- e.id::text to the segment never fails, it just does not match.
--
-- security definer for the same reason is_manager() and my_department() are:
-- the events table is behind row level security, and this should answer the same
-- way for every caller rather than depend on which rows that caller can read.
-- auth.uid() reads the request's JWT claim, which is unaffected by the definer,
-- so the answer is always about the caller.
create or replace function public.manages_event_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id::text = split_part(p_name, '/', 2)
      and e.department_id = public.my_department()
  );
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC, and there is no reason for
-- anon to hold it.
--
-- The grant back to authenticated is not redundant and must stay directly after
-- the revoke: revoking from PUBLIC withdraws EXECUTE from every role that had it
-- only by way of PUBLIC, and authenticated is one of those. Leave out the grant
-- and the storage policies below still compile, then fail at runtime with
-- "permission denied for function" on every upload.
revoke execute on function public.manages_event_media(text) from public, anon;
grant execute on function public.manages_event_media(text) to authenticated;

-- Writes are allowed into the caller's own folder, or into any event their
-- department owns.
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
    and (
      name like 'events/%/' || auth.uid()::text || '/%'
      or public.manages_event_media(name)
    )
  );

drop policy if exists event_media_update on storage.objects;
create policy event_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'event-media'
    and (
      name like 'events/%/' || auth.uid()::text || '/%'
      or public.manages_event_media(name)
    )
  )
  with check (
    bucket_id = 'event-media'
    and (
      name like 'events/%/' || auth.uid()::text || '/%'
      or public.manages_event_media(name)
    )
  );

drop policy if exists event_media_delete on storage.objects;
create policy event_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-media'
    and (
      name like 'events/%/' || auth.uid()::text || '/%'
      or public.manages_event_media(name)
    )
  );
