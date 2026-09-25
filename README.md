# EventArchive

An archive of college events. Teachers file events under their department, and
everyone signed in can browse what every other department has run.

Built with React + TypeScript + Vite, on **Supabase** (Postgres + Auth + Storage).

## What it does

- **One user type, `teacher`.** A `is_manager` flag on the profile is what
  unlocks the Setup screen; it is never set from the UI.
- **Every signed-in teacher can read every event**, so departments can see each
  other's work. Only the teacher who created an event may change or delete it.
- **Events are filed under your own department**, fixed at creation, along with
  the owning teacher. Neither can be reassigned later.
- **Status is derived from the date** — upcoming, ongoing, completed, or
  cancelled — and reconciled into the stored value so filters and the calendar
  agree with the clock rather than with a stale field.

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
| `events` | any signed-in teacher | owner only; owner and department fixed at creation |
| `departments` | any signed-in teacher | managers only |
| `profiles` | yourself, or any manager | managers only |
| `event-media` (storage) | any signed-in teacher | your own `{uid}` folder only |

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
  lib/          eventStatus (lifecycle), ownership
  pages/        Login, Dashboard, Events, EventDetails, Create/EditEvent, Setup
supabase/
  schema.sql    tables, RLS, storage policies, realtime publication
  functions/    create-teacher
```

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
