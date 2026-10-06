# AGENTS.md

React + TypeScript + Vite SPA on Supabase (Postgres, Auth, Storage). Deployed to
Vercel as a static bundle. There is no server, no API layer and no backend code
of ours — the browser talks to Supabase directly and **Postgres row level
security is the only security boundary.**

## Commands

```bash
pnpm build          # tsc -b (typecheck) + vite build. There is no separate typecheck script.
pnpm lint           # oxlint, NOT eslint
pnpm verify         # verify:lifecycle, then verify:sql, then verify:ui
pnpm verify:lifecycle   # status/cancellation rules + SQL shape. No network, no browser. Fast.
pnpm verify:sql     # runs schema.sql against a throwaway Postgres. Skips without one.
pnpm dev            # :5173
```

No CI, no husky, no pre-commit. Run `pnpm lint && pnpm build && pnpm verify`
before you call anything done.

### Testing is hand-rolled — do not reach for vitest/jest/playwright

There is no test framework and no test dependencies. Three scripts do the work:

- **`scripts/verify-lifecycle.mjs`** — loads `/src/lib/*.ts` through a Vite SSR
  server and asserts against it with its own `check()`. It also reads
  `supabase/schema.sql` and `src/**/*.ts` as **text** and regex-matches them.
  That is deliberate: the SQL and the TypeScript implement the same rules
  independently, and the assertions are what stop them drifting. It strips `--`
  comments before matching, because a check satisfied by a paragraph is worthless.
- **`scripts/verify-sql.mjs`** — applies `schema.sql` to a real Postgres and
  asserts what it does. Skips (exit 0) if none is found; `brew install
  postgresql@17`, or point `PG_BIN` at a `bin` directory. The app never connects
  to it — it exists only so the policies can be executed rather than read. It
  builds a throwaway cluster under the temp directory, connects over a unix
  socket, and deletes it on the way out; no service is registered and no
  existing cluster is touched.
- **`scripts/smoke-ui.mjs`** — drives headless Chrome over raw CDP. No
  Playwright/Puppeteer dep. Skips (exit 0) if no Chrome, or if nothing is
  serving `localhost:5173`. The signed-in half needs `SMOKE_EMAIL` and
  `SMOKE_PASSWORD`, and **skips silently without them** — always check whether
  it actually ran rather than trusting exit code 0. Override with `CHROME_PATH`
  and `SMOKE_BASE_URL`.

`verify:lifecycle` cannot execute SQL, so it can only tell you the file is
written the way it was written. That is a real limit and it has already cost a
bug: `revoke execute … from public` also strips EXECUTE from `authenticated`,
which every text-based check accepted and only a real database caught. **Any
change to a policy in `schema.sql` needs `pnpm verify:sql`, not just a careful
read.**

`tsconfig.app.json` includes only `src`. `scripts/` and
`supabase/functions/create-teacher` are untyped by the build — the latter is a
Deno edge function, so `Deno`/`jsr:` errors in your editor are expected noise.

## schema.sql is applied by hand

One file holds everything: tables, RLS, storage policies, realtime publication.
No migrations directory, no `supabase/config.toml`, no CLI workflow. Changes go
live by pasting it into Dashboard → SQL Editor. So:

- **Every statement must be re-runnable** — `create table if not exists`,
  `drop policy if exists` before `create policy`, guarded `alter publication`.
  A fresh database and an existing one both have to work.
- Remember the `drop column if exists` / `drop trigger if exists` lines when
  changing shape; a column added in an earlier paste will otherwise survive
  because `create table if not exists` skips an existing table.
- **Never put a `drop table` in `schema.sql`.** This file is pasted into a live
  project every time a column or a policy changes, so a drop at the top would
  take every event on every ordinary paste. Wiping the tables is
  `supabase/reset.sql`, which is only ever run on purpose: paste it, then paste
  `schema.sql` to rebuild. `verify:lifecycle` asserts both halves — no
  `drop table` anywhere in `schema.sql`, all three drops present in `reset.sql`,
  and `auth.users` untouched. Two things make a rebuild work, and both are easy
  to miss: the tables come back with **no grants of their own** (hence the
  explicit `grant` after the RLS enables — the failure is a silent
  "permission denied for table events" with correct policies), and every
  surviving account comes back with **no profile** (hence the backfill after
  `create table profiles` — `is_manager()` and `my_department()` both read that
  table, so a profile-less account is refused everywhere with nothing on screen
  to explain it). The backfill is `on conflict do nothing`, so a routine paste
  cannot overwrite a name, role or department a manager has already set.

The app has no `status` column and no scheduled jobs. **Do not reintroduce
them** — see below.

## The three decisions that will bite you

### 1. Status is never stored

There is deliberately no `status` column. `resolveStatus` in
`src/lib/eventStatus.ts` compares `event_date + start_time/end_time` to the
clock at render time, so a status cannot fall behind its date.

There *was* a stored status kept in step by a browser. It was wrong for a long
time: a browser can only write its own teacher's rows, so every event owned by
anyone else sat on `upcoming` long after it finished. Tests assert the column,
the trigger, the cron job and the client write-back are all **absent**. If you
find yourself wanting a background job to keep a status in step, that is the bug
coming back — derive it instead.

`cancelled_reason` is the exception: a hand cancellation (`'manual'`) is
something a person did, so it is stored and sticky. `'no_report'` is derived and
never written.

### 1a. Completed means a report exists

There are five derived statuses, and `completed` is not one of them until
`report` is set. The rule is:

| | |
| --- | --- |
| before start | `upcoming` |
| start … end | `ongoing` |
| ended, report uploaded | `completed` |
| ended, no report, within `REPORT_GRACE_DAYS` | `awaiting_report` |
| ended, no report, past it | `cancelled` (`no_report`) |

`awaiting_report` is a status and not a `pendingReport` boolean bolted onto
`completed`. It used to be the boolean, threaded through five components, and
that is two things describing one state — the one state where they can disagree
is the one that matters. `pnpm verify:lifecycle` asserts `pendingReport` appears
nowhere in `src/`. Do not bring it back.

`REPORT_GRACE_DAYS` (10) is the single place the window is set. `EventDetails`
interpolates it rather than spelling the number out, so changing it cannot leave
stale copy behind.

### 2. Event times are pinned to one zone

`EVENT_TIME_ZONE` in `src/lib/eventStatus.ts` is the single place. Times are
stored as a bare `HH:mm` with no zone, and it is pinned to `+05:30` rather than
read from the visitor's device, so a laptop set to UTC agrees with one set to
IST. There is a test asserting a `10:00` event maps to `04:30Z`.

### 2a. `src/lib/eventInput.ts` is the only place a form is judged

`validateEvent` is shared by `CreateEvent` and `EditEvent`, and the two forms
must not grow their own rules. It exists because the browser's validation is
not enough, and the two gaps are not obvious:

- `required` is satisfied by a run of spaces. An all-space title is stored as a
  blank card, not rejected. Everything is trimmed, then checked for emptiness.
- A date input cannot express an impossible date, but the value can arrive from
  anywhere. `2026-02-31` is rolled over by Postgres to 3 March, and
  `2026-02-29` only in a leap year. The date is checked against a real calendar
  before it is sent, not just against the regex.

`LIMITS` is shared with the `maxLength` attributes, so a cap is set in one
place. Do not add a field to only one of the two forms.

`participantCount` was removed from the form: the column stays in
`schema.sql`, nullable and unwritten, so rows created while the field existed
still read correctly on the details page.

### 3. RLS is the boundary; app checks are only for hiding buttons

| | Who may write |
| --- | --- |
| read `events` | any signed-in teacher |
| read `event-media` storage | **managers only** |
| create `events` | own department, and `coordinator_id = auth.uid()` |
| update / delete `events` | **anyone in the owning department** |
| upload media | own folder, or any event in the owning department |
| `departments`, `profiles` | managers only |

The app mirrors the write rules in `src/lib/permissions.ts` (`canManageEvent`)
purely so it can hide buttons. `verify-lifecycle` asserts the SQL and the
TypeScript agree.

**Who filed an event is a fact about the archive, not a filter over it.** There
is no "My Events" view and no `isMine`, and there is no Dashboard page either:
`/events` is the front page, grouped by department (the viewer's own first), and
every card and details page says `Created by <name>`. The reason is that a
per-teacher view — and then a second page showing the same events grouped rather
than filtered — was always a worse copy of the department's list: either a
duplicate or an empty box, and a creator check in a component is exactly the
kind of thing that later gets mistaken for a permission. `verify:lifecycle`
asserts none of it comes back.

Reading that name is the one thing the client cannot do, because
`profiles_select` only lets a teacher read their own row. So the name is
**copied onto the event at creation** rather than the policy being widened: the
`events_stamp_coordinator_name` trigger overwrites whatever the client sent with
`my_name()`. `fromEvent` is a whitelist and deliberately omits
`coordinator_name`, so the value cannot be sent at all. Widening `profiles_select`
to every teacher would leak every teacher's name and email to the whole staff —
a one-line change for something the trigger already does.

`coordinator_id` and `department_id` are pinned at creation by the
`events_pin_immutable` trigger, and so is `coordinator_name` once it is set —
otherwise any teacher in the department could rewrite who an archived event is
credited to. A name that is still `NULL` may be filled in, because the backfill
in `schema.sql` has to credit events that predate the column. This **cannot** be done in policy conditions:
inside `with check` a reference to the table resolves to the row being written,
so comparing a column against `select … where id = events.id` compares the new
value with itself and always passes. Only a trigger sees both `OLD` and `NEW`.

`events_update` needs **both** `using` and `with check` naming
`my_department()`. The `using` picks whose rows you can write; the `with check`
stops you moving an event into a department you do not belong to and continuing
to write to it. Dropping the `with check` reopens that.

## Storage paths are load-bearing

Layout is `events/{eventId}/{uid}/{folder}/{file}`, bucket `event-media`.

- **The event id is segment 2.** `public.manages_event_media()` reads it with
  `split_part(name, '/', 2)`; `pathFor()` in `src/supabase/storage.ts` writes it
  there. Move either and department media access silently reverts to your own
  folder. Tests assert both sides.
- Compare ids as text (`e.id::text = split_part(...)`), **never** cast the
  segment to `uuid` — the path is caller-controlled, and a cast raises
  `invalid_input_syntax` on anything that is not a uuid, taking legitimate
  requests down with it.
- Match the caller's own folder with `like 'events/%/' || auth.uid()::text || '/%'`,
  **not** `storage.foldername(name)[n]`. `foldername` is 1-INDEXED (Supabase's
  own examples use `[1]`), so the uid is at `[3]`, not `[2]`. The off-by-one
  compares the eventId to the uid and denies every upload.
- The bucket is **private**. Store the path, never a URL. The cover is rendered
  through `useSignedUrl`; everything else is signed when a teacher asks for it
  with `useOnDemandSigner`. Only the cover is automatic, because the list shows
  it and a card without a picture is not a card — signing the whole gallery on
  arrival would pull every photo off storage just by opening an event.
- **Reads are managers-only; writes are not.** `event_media_select` requires
  `is_manager()`, and a signed URL is minted only for a caller that policy lets
  see the object — so an ordinary teacher can upload a cover or file a report
  and cannot open it again. The app mirrors this so it never fires a request the
  policy will refuse: every signing site is gated on `isManager`
  (`EventCard`, `EventDetails`), and the gallery and report sections are not
  drawn for anyone else. The upload buttons stay under `canManage`, because
  filing media is part of running an event. Do not widen the select policy to
  make a photo appear for a teacher — that is the rule changing, not a bug.
- **That select policy also decides who may overwrite or delete**, which is the
  non-obvious half: Postgres applies it to a `DELETE` with a `WHERE` clause and
  to `on conflict do update`, so a non-manager's *insert* is the only write that
  lands — the update and delete policies naming the department are unreachable
  for them. Hence **no path is ever written twice**: every upload, the cover
  included, carries a timestamp and there is no `upsert`, so replacing a photo
  is a fresh insert rather than an overwrite. Put a fixed file name back and a
  teacher's second cover upload fails.
- A gallery photo is drawn **inside its own tile**, not opened over the page. A
  grid is meant to be looked at, and a dialog showing one image at a time puts
  that back to one press per photo; the tile carries a full-size link for when
  the thumbnail really is too small. `useOnDemandSigner` keeps `urls` and
  `pending` as maps keyed by path, so a second tile can be pressed while the
  first is still loading.
- `MAX_BYTES` in `src/supabase/storage.ts` must match `file_size_limit` on the
  bucket in `schema.sql`.
- `public` functions are executable by `anon` by default. `is_manager()`,
  `my_department()` and `manages_event_media()` are `security definer` but only
  ever answer about the caller, which is what makes that safe. Do not add a
  definer function that takes an argument without checking who can reach it.
- **A `revoke … from public` on a function needs a matching `grant` to
  `authenticated` right after it.** Revoking from `PUBLIC` withdraws EXECUTE
  from every role that had it only by way of `PUBLIC`, and `authenticated` is
  one of those. The policies still compile; they fail at runtime with
  "permission denied for function" on every upload. This happened, and only
  `verify:sql` caught it.

## Smaller traps

- **The profile arrives on its own subscription**, separately from event data.
  Any permission check reading `profile?.departmentId` must wait for the profile
  or it will treat "not loaded yet" as "not your department" and wrongly lock the
  page. This shipped once in `EditEvent`.
- `events` must be in the `supabase_realtime` publication. Without it,
  subscriptions connect fine and silently never deliver — looks exactly like a
  broken app. The file guards this so it stays re-runnable.
- `on_table_created_in_public` switches on RLS for new `public` tables. It does
  **not** cover views (create them with `security_invoker = true`), tables
  outside `public`, or functions.
- `useNow()` (`src/hooks/useNow.ts`) ticks every 60s so time-derived status stays
  truthful without a database write. Anything time-based in the UI should read
  it rather than calling `new Date()` during render.
- `noUnusedLocals` / `noUnusedParameters` are on, and `verbatimModuleSyntax`
  means type-only imports need `import type`. Neither is enforced by oxlint, so
  `pnpm lint` alone will not catch them — `pnpm build` will.
- Never put `service_role` in `.env`. Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` belong there, and RLS is the only thing protecting the
  anon key.
- Column names are `snake_case`, app names are `camelCase`. Every row crosses
  that boundary in `src/supabase/mappers.ts` — a new column needs entries in
  both `toEvent` and `fromEvent`.

## House style

Comments explain **why**, not what, and this codebase is deliberate about
recording the reasoning behind non-obvious choices and traps (see the storage
`foldername` note and the `with check` note in `schema.sql`). Match that: when
you fix a bug or work around a framework quirk, leave a comment that would stop
the next person re-introducing it. Do not add comments restating the code.

The `verify-lifecycle` assertions are part of that style — they encode decisions,
not just behaviour. When you change a rule, update the assertion that guards it
in the same commit.
