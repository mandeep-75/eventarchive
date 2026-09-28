# EventArchive

An archive of college events. Teachers file events under their department, and
everyone signed in can browse what every other department has run.

Built with React + TypeScript + Vite, on **Supabase** (Postgres + Auth + Storage).

## What it does

- **One user type, `teacher`.** A `is_manager` flag on the profile is what
  unlocks the Setup screen; it is never set from the UI.
- **Every signed-in teacher can read every event**, so departments can see each
  other's work.
- **Any teacher can edit an event belonging to their own department**, not only
  the one who created it. Creating is still personal: you own what you file, and
  an event's department and creator are fixed at creation.
- **Status is worked out from the date and times**, never stored — upcoming,
  ongoing, awaiting report, completed, or cancelled. The database holds the
  event's date and times; each page compares them to the clock when it renders,
  so a status can never fall behind the date it is meant to describe.
- **An event is only completed once a report has been uploaded for it.** Between
  the end of the event and `REPORT_GRACE_DAYS` (10) it reads *Awaiting report*,
  and after that it is cancelled for want of a report. Change the constant in
  `src/lib/eventStatus.ts` to adjust the window — it is the same number
  everywhere, including the copy on the page.

## Setup

### 1. Install

```bash
pnpm install
```

### 2. Create the database

Create a Supabase project, then run `supabase/schema.sql` in the SQL editor
(Dashboard → SQL Editor → New query). It creates the tables, the row level
security policies, the `event-media` storage bucket and its policies, and adds
the three tables to the realtime publication.

> The realtime lines are not optional. Without them, subscriptions connect
> successfully and silently never deliver an update, which looks exactly like a
> broken app.

#### Starting over

To wipe the data and rebuild the tables, run `supabase/reset.sql` in the SQL
editor and then run `schema.sql` again. Two pastes, in that order — `reset.sql`
only drops, and the table definitions live in `schema.sql`.

`auth.users` is left alone, so existing accounts can still sign in; their
profiles are rebuilt automatically but come back with no department, and a
manager has to place them. Departments and every event are gone. Uploaded covers
and reports are untouched, since those files are not in the database.

`reset.sql` is a separate file on purpose. `schema.sql` is pasted on every
column or policy change, so a `drop table` sitting in it would destroy the
project's data every time someone changed a column.

Event times are stored as a bare date and `HH:mm` with no time zone, so the zone
they belong to is stated once, as `EVENT_TIME_ZONE` in
`src/lib/eventStatus.ts`. It is pinned rather than read from the visitor's
device, so a laptop set to UTC sees the same times as one set to IST.

### 3. Point the app at it

```bash
cp .env.example .env
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
Dashboard → Project Settings → API.

The anon key is safe in the browser — every table and storage object sits behind
row level security. **Never** put the `service_role` key in `.env`; it bypasses
RLS and would hand every visitor full access to the database.

### 4. Deploy the account-creation function

Setup → "Add a teacher" calls an edge function rather than
`supabase.auth.signUp`, because `signUp` signs a session in as the new teacher
and would eject the manager mid-provision. The function holds the service-role
key so the browser never sees it.

```bash
supabase functions deploy create-teacher
```

Leave the function's **Verify JWT** setting on.

### 5. Create the first manager

Accounts are provisioned by a manager, so bootstrap the first one directly:

1. Sign up in Supabase → Authentication → Users → **Add user**, and confirm the
   email.
2. Insert a profile for that user, with `is_manager` true:

```sql
insert into public.profiles (id, name, email, department_id, is_manager)
select id, 'Your Name', email,
       (select id from public.departments limit 1), true
from auth.users
where email = 'you@example.com';
```

Add your departments first, then sign in and use Setup to create the rest of the
accounts.

## Security model

Enforced in Postgres, not in the UI — hiding a button is not access control.

| Table | Read | Write |
| --- | --- | --- |
| `events` | any signed-in teacher | your own department; creator and department fixed at creation |
| `departments` | any signed-in teacher | managers only |
| `profiles` | yourself, or any manager | managers only |
| `event-media` (storage) | any signed-in teacher | your own `{uid}` folder, or any event your department owns |

Creating an event is still personal: `events_insert` requires
`coordinator_id = auth.uid()`, so you own what you file. Only editing and
deleting are department-wide.

Each event shows **Created by** with the filer's full name. The name is copied
onto the event at creation by a trigger, because a teacher can only read their
own profile row and so the browser cannot look up a colleague's name. A value
sent by the client is overwritten, and a name already on an event cannot be
changed afterwards.

`events_update` has both a `using` and a `with check` naming `my_department()`.
The `using` decides whose rows you can write; the `with check` is what stops you
moving an event into a department you do not belong to and carrying on writing to
it. `using` alone would allow that.

The `events_pin_immutable` trigger holds the owning teacher and department
fixed. This has to be a trigger rather than more policy conditions: inside
`with check`, a reference to the table resolves to the row being written, so
comparing a column against `select … from public.events where id = events.id`
compares the new value with itself and always passes.

A second trigger, `on_table_created_in_public`, switches on RLS for any table
created in the `public` schema. Supabase auto-exposes that schema over its REST
API, so a table created in the SQL editor without RLS is readable by anyone
holding the anon key. Enabling RLS grants nothing on its own — a table with no
policies is invisible, not open — so this only makes the default fail closed.

**What that trigger does not cover:** views and materialized views (a view does
not inherit the RLS of the tables behind it; create them with
`security_invoker = true`), tables outside `public`, and functions in `public`,
which are executable by `anon` by default. `is_manager()` and `my_department()`
are `security definer` but only ever return the caller's own row, so calling
them directly leaks nothing — keep it that way, and do not add a definer
function that takes an argument without checking who can reach it.

## Project layout

```
src/
  supabase/     client, auth, data access, storage, row mappers
  context/      AuthContext — session + profile
  hooks/        useEvents, useDepartments, useNow
  lib/          eventStatus (worked out from the date), permissions
  pages/        Login, Dashboard, Events, EventDetails, Create/EditEvent, Setup
supabase/
  schema.sql    tables, RLS, storage policies, realtime publication
  reset.sql     drops the tables so schema.sql can rebuild them (on purpose)
  functions/    create-teacher

Postgres columns are `snake_case` and the app is `camelCase`; every row crosses
that boundary in `src/supabase/mappers.ts`.

## Verifying

```bash
pnpm build          # typecheck + bundle
pnpm lint
pnpm verify         # lifecycle rules, then a browser smoke test
```

`pnpm verify:lifecycle` covers the status and cancellation rules with no
network. `pnpm verify:ui` drives a real browser and checks the signed-out flow;
it also runs the signed-in checks when `SMOKE_EMAIL` and `SMOKE_PASSWORD` are
set, and skips them with a notice when they are not.
