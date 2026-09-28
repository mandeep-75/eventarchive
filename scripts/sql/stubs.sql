-- Stand-ins for the parts of a Supabase project that schema.sql assumes are
-- already there. Only what schema.sql actually touches is provided, so that
-- anything it starts depending on shows up here as a missing piece rather than
-- passing by accident.
--
-- This is test scaffolding, not part of the app. It is applied by
-- scripts/verify-sql.mjs to a throwaway Postgres cluster.

-- ─── Roles ─────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on new functions to PUBLIC, and every policy in
-- schema.sql names one of these, so both roles have to exist before the file
-- runs or `create policy` fails on a missing role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- ─── auth ──────────────────────────────────────────────────────────────────
-- Supabase owns this schema. schema.sql reaches into it twice: the profiles
-- foreign key, and auth.uid() in every policy.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  -- The sign-up form writes the display name here, and the profile backfill in
  -- schema.sql reads it back out.
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- The real function reads the signed request's JWT. Reading the same claim out
-- of the same GUC means a test can stand in for a signed-in teacher with
-- `set local request.jwt.claims`, and the security-definer functions under test
-- see an identical caller.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- Parenthesised around the whole expression: `::` binds tighter than `->>`,
  -- so without this the cast lands on the literal 'sub'.
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

-- ─── storage ───────────────────────────────────────────────────────────────
-- Same story: the bucket and object tables belong to Supabase, and schema.sql
-- inserts a row into buckets and writes policies against objects.
create schema if not exists storage;

create table if not exists storage.buckets (
  id    text primary key,
  name  text,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS on, exactly as Supabase ships it. Without this the policies below would
-- be inert and every test would pass for the wrong reason.
alter table storage.objects enable row level security;

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- schema.sql guards its `alter publication … add table` on the publication
-- being present, so it has to predate the file. CREATE PUBLICATION has no
-- IF NOT EXISTS, hence the block.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
