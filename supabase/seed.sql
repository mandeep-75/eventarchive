-- EventArchive — demo seed data
--
-- Fills a fresh project with the college's departments and one event, so the
-- list, the calendar and the department grouping have something to show. It is
-- deliberately NOT part of supabase/schema.sql: that file is pasted into a live
-- project every time a column or a policy changes, and demo rows reappearing on
-- every ordinary paste is exactly what you do not want. Run this by hand, once.
--
-- How to run: paste into Supabase → SQL Editor and run it, after schema.sql.
--
-- The project has a single manager, `test`, and a teacher, `test1@gmail.com`.
-- This file does not create logins or set anyone's role or department — accounts
-- are made through the app (Setup → create teacher), which is the only path that
-- can set a password. It only creates the departments, and files the one event
-- the teacher owns. Place `test1` in Commerce through the app so the event's
-- department and the teacher's line up.
--
-- It is re-runnable. Departments are keyed on their unique name and the event on
-- a fixed id, both with `on conflict do nothing`, and the event's teacher and
-- department are looked up by email and name. So a second run is a no-op, and on
-- a project missing that teacher or department a row is skipped rather than
-- failing the whole file.
--
-- The date is relative to the day it is run, so the event reads as upcoming
-- whenever the seed is applied.
--
-- The event is seeded with no report, which is the state every event starts in.
-- Once it is over, any teacher in Commerce may file the report from the event
-- page: the storage insert policy asks only for the owning department, so
-- filing belongs to the department rather than to managers. Reading it back is
-- the other half — event_media_select is managers-only, so the same teacher who
-- filed it cannot open it again and a manager can.

insert into public.departments (name)
values
  ('Agriculture'),
  ('Chemistry'),
  ('Commerce'),
  ('Computer science'),
  ('Economics'),
  ('English'),
  ('Fashion Designing'),
  ('Hindi'),
  ('History'),
  ('Library science'),
  ('Mathematics'),
  ('Music'),
  ('Physical Education'),
  ('Physics'),
  ('Political Science'),
  ('Punjabi'),
  ('Collage Library')
on conflict (name) do nothing;

insert into public.events (
  id, title, department_id, coordinator_id, event_date, start_time, end_time,
  venue, description, guest_speaker, collaboration, report, report_name,
  cancelled_reason, cancelled_at
)
select
  v.id,
  v.title,
  d.id,
  p.id,
  v.event_date,
  v.start_time,
  v.end_time,
  v.venue,
  v.description,
  v.guest_speaker,
  v.collaboration,
  null,
  null,
  null,
  null
from (values
  -- id, title, department, coordinator email, date, start, end, venue,
  -- description, guest, collaboration
  ('3442f1e7-04bc-4c05-9b08-ccb36892ebe1'::uuid,
   'Commerce Fest 2026', 'Commerce', 'test1@gmail.com',
   (current_date + 5)::date, '10:00'::time, '12:00'::time, 'Main Auditorium',
   'Department festival with guest stalls, a product pitch and an alumni panel.',
   'Alumni panel', 'Entrepreneurship cell')
) as v (id, title, dept_name, coord_email, event_date, start_time, end_time,
        venue, description, guest_speaker, collaboration)
join public.departments d on d.name = v.dept_name
join public.profiles    p on p.email = v.coord_email
on conflict (id) do nothing;

-- Credit the event to the teacher who filed it.
--
-- The insert trigger stamps coordinator_name from public.my_name(), which reads
-- the signed-in caller — and a paste in the SQL editor is not signed in, so it
-- comes back null. This is the same backfill schema.sql runs, narrowed to the
-- rows that are still blank, so it fills the seed in without ever overwriting a
-- name the app already recorded.
update public.events e
set coordinator_name = p.name
from public.profiles p
where p.id = e.coordinator_id
  and e.coordinator_name is null;
