-- EventArchive — reset
--
-- Drops the three app tables so that supabase/schema.sql rebuilds them from
-- scratch. Use it when the live database has drifted from the file — a column
-- added by hand, a policy left over from an older rule, or you simply want a
-- clean slate.
--
-- This is destructive and it is NOT kept in schema.sql, because schema.sql is
-- pasted into a live project every time a column or a policy changes. A drop
-- sitting at the top of that file would take every event with it on every
-- ordinary paste. Here it is, on its own, where it is only ever run on purpose.
--
-- ─── What survives, and what does not ─────────────────────────────────────
--   auth.users        KEPT. Accounts are not deleted. (Deleting from
--                     auth.users is possible but is not something to do by
--                     accident, and it would leave the accounts unable to sign
--                     in at all. Use the Dashboard's Authentication → Users if
--                     you really want them gone.)
--   public.departments  DROPPED. Recreated empty — re-add them in the app.
--   public.profiles     DROPPED, then rebuilt for every surviving account by
--                        the backfill in schema.sql, with no department.
--   public.events       DROPPED. Every event is gone.
--   storage bucket      UNTOUCHED, along with every uploaded cover and report.
--                        The files are not in the database, so dropping the
--                        bucket row would orphan them. schema.sql refreshes the
--                        bucket's size limit with `on conflict do nothing` and
--                        rewrites the storage policies.
--
-- ─── How to run it ────────────────────────────────────────────────────────
--   1. Paste this whole file into Supabase → SQL Editor and run it.
--   2. Paste supabase/schema.sql and run it. This is what recreates the tables.
--   3. Sign in and re-create the departments, then have a manager place the
--      accounts into one. Accounts come back with a profile but no department,
--      so until they are placed they can read but cannot create events — that is
--      the `events_insert` policy doing its job, not a fault.
--
-- Step 1 and step 2 cannot be merged: the table definitions live in schema.sql,
-- and duplicating them here would let the two copies drift.

-- Reverse dependency order. events references both of the others, and profiles
-- references departments, so each goes before what it points at. CASCADE covers
-- anything an older version of this schema left depending on them (a view, a
-- foreign key from a table that no longer exists in the file).
drop table if exists public.events cascade;
drop table if exists public.profiles cascade;
drop table if exists public.departments cascade;

-- The event trigger is database-wide rather than per-table, so it stays
-- registered and re-enables RLS on each table as schema.sql recreates it. It
-- and the security-definer functions are all `create or replace`, so a leftover
-- copy from a previous version of the schema is overwritten rather than needing
-- to be dropped first.

-- Confirm afterwards, before rebuilding: all three should report no such table.
--   select * from public.events;
