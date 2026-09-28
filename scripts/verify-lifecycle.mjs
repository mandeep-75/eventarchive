import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'vite'

const DAY = 86400000

function ev(overrides = {}) {
  const d = new Date(Date.now() - 10 * DAY)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    id: 'e1',
    title: 'T',
    departmentId: 'd1',
    date,
    startTime: '10:00',
    endTime: '12:00',
    venue: 'V',
    description: '',
    coverImage: null,
    images: [],
    coordinatorId: 'teacher-1',
    createdAt: d,
    updatedAt: d,
    ...overrides,
  }
}

function dateOffset(days) {
  const d = new Date(Date.now() + days * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let failed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`)
}

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })
const { resolveStatus, REPORT_GRACE_DAYS, eventEnd } = await server.ssrLoadModule('/src/lib/eventStatus.ts')
const eventEndMs = (e) => eventEnd(e).getTime()

const now = new Date()

// --- lifecycle ---
// Every case below starts from a row that stores nothing but a date, times and
// whether a report was filed. The status is worked out at read time, so there is
// no stored value that can fall behind — which is the whole point.
const { eventStart } = await server.ssrLoadModule('/src/lib/eventStatus.ts')

// A bare `10:00` means 10:00 in the app's zone, so it is 04:30 UTC. Pinned
// rather than taken from the browser so the answer is the same on a phone set
// to UTC and on a laptop set to IST.
check('10:00 is read as IST, not browser-local',
  eventStart({ date: '2026-10-01', startTime: '10:00' }).toISOString(),
  '2026-10-01T04:30:00.000Z')

// A `time` column answers `HH:mm:ss` no matter what was written to it, so this is
// the shape every row in the database actually has. The status rule's format
// string has no seconds token, so an untrimmed value leaves `:00` between the
// minutes and the zone and the parse fails — and a failed parse used to answer
// `upcoming`, which is a finished event indistinguishable from one that has not
// started. Every assertion above passes `HH:mm` by hand and would not have caught
// it; these deliberately do not.
const { normalizeClock } = await server.ssrLoadModule('/src/lib/eventStatus.ts')
const { toEvent } = await server.ssrLoadModule('/src/supabase/mappers.ts')

const row = {
  id: 'e1',
  title: 'Computer Science & Engineering',
  department_id: 'd1',
  event_date: '2026-09-22',
  start_time: '22:45:00',
  end_time: '23:45:00',
  venue: 'ecs',
  description: 'uytcyu',
  coordinator_id: 'u1',
  images: [],
  report: null,
  cancelled_reason: null,
}
const fromRow = toEvent(row)
check('a time column is trimmed to HH:mm on the way in',
  [fromRow.startTime, fromRow.endTime], ['22:45', '23:45'])
check('the seconds do not make a past event look upcoming',
  resolveStatus(fromRow, new Date('2026-09-28T10:00:00+05:30')).status, 'awaiting_report')
check('…and a stale one is still cancelled for want of a report',
  resolveStatus({ ...fromRow, date: '2026-09-01' }, new Date('2026-09-28T10:00:00+05:30')).status,
  'cancelled')
check('a time with seconds is still read as the app zone',
  eventStart({ date: '2026-10-01', startTime: '10:00:00' }).toISOString(),
  '2026-10-01T04:30:00.000Z')
check('the display agrees with the rule, because both read the mapped value',
  normalizeClock(fromRow.startTime), fromRow.startTime)
check('a missing time is midnight, not a crash',
  [normalizeClock(null), normalizeClock(''), normalizeClock('  ')], ['00:00', '00:00', '00:00'])

const future = ev({ date: dateOffset(5) })
check('future event -> upcoming', resolveStatus(future, now).status, 'upcoming')

const today = ev({ date: dateOffset(0), startTime: '00:00', endTime: '23:59' })
check('spanning now -> ongoing', resolveStatus(today, now).status, 'ongoing')

const pastNoReport = ev({ date: dateOffset(-1) })
check('ended yesterday, no report -> awaiting_report', resolveStatus(pastNoReport, now).status, 'awaiting_report')

const pastWithReport = ev({ date: dateOffset(-1), report: 'https://x/r.pdf' })
check('ended yesterday, has report -> completed', resolveStatus(pastWithReport, now).status, 'completed')

const stale = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)) })
const staleRes = resolveStatus(stale, now)
check('ended 10d ago, no report -> cancelled', staleRes.status, 'cancelled')
check('ended 10d ago -> reason no_report', staleRes.reason, 'no_report')
check('ended 10d ago -> autoCancelled true', staleRes.autoCancelled, true)

const staleWithReport = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), report: 'https://x/r.pdf' })
check('ended 10d ago, has report -> completed', resolveStatus(staleWithReport, now).status, 'completed')

check('ended 6d ago, no report -> awaiting_report (inside grace)', resolveStatus(ev({ date: dateOffset(-6) }), now).status, 'awaiting_report')
check('ended 8d ago, no report -> awaiting_report (still inside 10d)', resolveStatus(ev({ date: dateOffset(-8) }), now).status, 'awaiting_report')
check('ended 11d ago, no report -> cancelled (outside grace)', resolveStatus(ev({ date: dateOffset(-11) }), now).status, 'cancelled')

// Exact boundary: an event ending precisely the grace period before the reference instant.
function endsExactlyDaysAgo(days) {
  const t = new Date(now.getTime() - days * DAY)
  const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return ev({ date, startTime: hhmm, endTime: hhmm })
}
const boundary = endsExactlyDaysAgo(REPORT_GRACE_DAYS)
// grace expires AT end + REPORT_GRACE_DAYS, so compare around that instant directly.
const graceEnd = new Date(eventEndMs(boundary) + REPORT_GRACE_DAYS * DAY)
check('1 min before grace end -> awaiting_report',
  resolveStatus(boundary, new Date(graceEnd.getTime() - 60000)).status, 'awaiting_report')
check('at grace end -> cancelled',
  resolveStatus(boundary, graceEnd).status, 'cancelled')
check('1 min after grace end -> cancelled',
  resolveStatus(boundary, new Date(graceEnd.getTime() + 60000)).status, 'cancelled')

// --- a hand cancellation is the one stored fact ---
// A person cancelling an event is something that happened, so it is recorded and
// kept. The no_report cancellation is the opposite: it is implied by the date and
// a missing report, so it is worked out rather than stored.
const manual = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), cancelledReason: 'manual' })
const manualRes = resolveStatus(manual, now)
check('hand cancel -> cancelled', manualRes.status, 'cancelled')
check('hand cancel -> not auto', manualRes.autoCancelled, false)
check('hand cancel -> reason manual', manualRes.reason, 'manual')
check('hand cancel on a future event -> still cancelled',
  resolveStatus(ev({ date: dateOffset(30), cancelledReason: 'manual' }), now).status, 'cancelled')

// A no_report left over in the row from before it stopped being stored is
// ignored, so those events are judged on their date instead of being pinned.
check('a stored no_report is ignored in favour of the date',
  resolveStatus(ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), cancelledReason: 'no_report' }), now).reason,
  'no_report')
check('a stored no_report on a future event does not stick',
  resolveStatus(ev({ date: dateOffset(30), cancelledReason: 'no_report' }), now).status, 'upcoming')

// --- uploading a report reopens a cancelled event ----------
// A report means the event happened, so a hand cancellation is dropped and the
// event is judged on its date. Without the !report guard in resolveStatus, a
// report landing on a cancelled event would be read back as a hand cancellation
// and the event could never be closed off.
const afterUpload = { ...manual, report: 'R.pdf' }
check('report on hand-cancelled event -> completed', resolveStatus(afterUpload, now).status, 'completed')
check('report on hand-cancelled event -> not manual', resolveStatus(afterUpload, now).reason, null)
check('report on hand-cancelled event -> completed', resolveStatus(afterUpload, now).status, 'completed')

// The whole point of the rule: no report means never completed, however long ago
// it ended. Anything else would call an event done that nobody has written up.
check('no report is never completed, whatever the age',
  [1, 5, 9, 20, 400].map((d) => resolveStatus(ev({ date: dateOffset(-d) }), now).status === 'completed'),
  [false, false, false, false, false])

// ─── Nothing stores the status ─────────────────────────────────────────────
// The original bug was a stored status column that only a browser could keep up
// to date, and a browser can only update its own teacher's rows, so every other
// event sat on 'upcoming' long after it finished. The fix is not a better
// updater — it is that there is no longer anything to keep up to date. These
// guard that, since putting the column back would bring the bug straight back.

const sqlFile = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
// Comments are stripped before any of the checks below. A check that passes
// because a paragraph happens to mention a pattern is worse than no check at
// all — several of these assert the *absence* of a cast, and the explanation
// next to it has to name that cast to be useful.
const sql = sqlFile.replace(/--[^\n]*/g, '')
// The drop lives in its own file, and this is the decision that keeps it there.
// schema.sql is pasted into a live project every time a column or a policy
// changes; a `drop table` at the top of it would take every event on every
// ordinary paste. Strip comments first, so a paragraph warning about this cannot
// satisfy the check.
const resetFile = readFileSync(new URL('../supabase/reset.sql', import.meta.url), 'utf8')
const reset = resetFile.replace(/--[^\n]*/g, '')
check('sql: schema.sql contains no drop table at all', /\bdrop\s+table\b/.test(sql), false)
for (const t of ['public.events', 'public.profiles', 'public.departments']) {
  check(`sql: reset.sql drops ${t}`,
    new RegExp(`drop\\s+table\\s+if\\s+exists\\s+${t.replace('.', '\\.')}\\s+cascade`).test(reset), true)
}
// auth.users is Supabase's, and deleting from it is not something this project
// should do by accident — the accounts would be left unable to sign in at all.
check('sql: reset.sql does not touch auth.users', /\bauth\s*\.\s*users\b/.test(reset), false)

const eventsHook = readFileSync(new URL('../src/hooks/useEvents.ts', import.meta.url), 'utf8')
const statusLib = readFileSync(new URL('../src/lib/eventStatus.ts', import.meta.url), 'utf8')
const typesSrc = readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
// Every source file, so a check can assert something is absent everywhere rather
// than in the one place it used to live.
const srcFiles = ['src'].flatMap(function walk(dir) {
  return readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
}).filter((f) => /\.tsx?$/.test(f))
  .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))

const statusLabels = (await server.ssrLoadModule('/src/types/index.ts')).STATUS_LABELS

// No column, and an explicit drop for databases that already have one.
check('sql: no status column on events',
  /^\s*status\s+text/m.test(sql), false)
check('sql: an existing status column is dropped',
  /alter table public\.events drop column if exists status;/.test(sql), true)

// No trigger and no scheduled job either: with no stored value there is nothing
// for either of them to maintain, and a sweep would need privileges to reach
// rows the RLS update policy deliberately keeps away from clients.
check('sql: no trigger maintains a status', /create trigger/i.test(sql) && /status/i.test(sql.split('create trigger').pop() ?? ''), false)
check('sql: no scheduled status job', /cron\.schedule|sync_event_statuses|event_lifecycle/.test(sql), false)
check('sql: no privileged status writer', /security definer[\s\S]{0,400}status/i.test(sql), false)

// And the app never writes one either.
check('app: the event type has no status field',
  /status: EventStatus/.test(readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
    .split('export interface CollegeEvent')[1] ?? ''), false)
check('app: no status write-back from the list', /updateEvent|planStatusSync/.test(eventsHook), false)
check('app: the rule reads only date, times and report',
  /export type StatusInput = Pick<[\s\S]*?'date' \| 'startTime' \| 'endTime' \| 'report'/.test(statusLib), true)

// awaiting_report is a status, not a flag. It used to be a `pendingReport`
// boolean threaded alongside `completed`, which is two things describing one
// state — and the one state where they could disagree is the one that matters.
check('app: the pending window is a status, not a second source of truth',
  /awaiting_report/.test(statusLib) && /awaiting_report/.test(typesSrc)
  && !/pendingReport/.test(statusLib)
  && srcFiles.filter((f) => /pendingReport/.test(f)).length === 0, true)
check('app: every status has a label',
  Object.keys(statusLabels).sort().join(','),
  ['awaiting_report', 'cancelled', 'completed', 'ongoing', 'upcoming'].join(','))

// --- department permission ---
// Editing is a department permission, not a personal one. These matter mostly
// because the database enforces the same rule independently in the
// events_update and events_delete policies: if the two ever disagree, the app
// either hides buttons that would have worked, or offers buttons that fail.
const { canManageEvent } = await server.ssrLoadModule('/src/lib/permissions.ts')

const ownDept = ev({ departmentId: 'dept-a' })
check('a teacher can manage their own department\'s event', canManageEvent(ownDept, 'dept-a'), true)
check('a colleague in the same department can manage it', canManageEvent(ownDept, 'dept-a'), true)
check('another department cannot', canManageEvent(ownDept, 'dept-b'), false)
check('a teacher with no department cannot', canManageEvent(ownDept, null), false)
check('signed out cannot', canManageEvent(ownDept, undefined), false)

// The creating teacher is recorded for display only, so a colleague in the same
// department manages an event they did not file.
check('creator being someone else does not block the department',
  canManageEvent({ departmentId: 'dept-a', coordinatorId: 'someone-else' }, 'dept-a'), true)

// The same rule, asserted against the SQL, since that is the real boundary.
check('sql: update is scoped to the caller\'s department',
  /create policy events_update[\s\S]*?using \(department_id = public\.my_department\(\)\)/.test(sql), true)
check('sql: delete is scoped to the caller\'s department',
  /create policy events_delete[\s\S]*?using \(department_id = public\.my_department\(\)\)/.test(sql), true)
// The with check is what stops an event being moved to a department the caller
// does not belong to. `using` alone would still allow the write.
check('sql: update cannot move an event out of the department',
  /create policy events_update[\s\S]*?with check \(department_id = public\.my_department\(\)\)/.test(sql), true)
// Writing an event is still personal: you own what you file.
check('sql: creating still requires owning what you file',
  /create policy events_insert[\s\S]*?coordinator_id = auth\.uid\(\)/.test(sql), true)
// coordinator_id stays pinned, so a department cannot hand its event to a
// teacher in another department.
check('sql: the creating teacher is still pinned at creation',
  /coordinator_id is fixed at creation/.test(sql), true)

// ─── Created by ─────────────────────────────────────────────────────────────
// The filer's name is copied onto the event at creation, because profiles_select
// only lets a teacher read their own row and so "who created this" is not
// answerable from the client. These guard the three things that makes safe:
// the column exists, the value is set by the database rather than the client,
// and it cannot be rewritten afterwards.
check('sql: events carry the filer\'s name', /coordinator_name\s+text/.test(sql), true)
check('sql: an existing project gains the column',
  /add column if not exists coordinator_name text/.test(sql), true)
check('sql: the name is read from the caller\'s own profile',
  /select name from public\.profiles where id = auth\.uid\(\)/.test(sql), true)
// A trigger, not the app: a client able to send the value could credit an event
// to anyone, and the insert policy alone would not stop it.
check('sql: the name is stamped on insert by a trigger',
  /create trigger events_stamp_coordinator_name\s*\n\s*before insert on public\.events/.test(sql), true)
check('sql: …which overwrites whatever the client sent',
  /new\.coordinator_name := public\.my_name\(\)/.test(sql), true)
// A column that can be edited is not a record of anything.
check('sql: a name that is already there cannot be rewritten',
  /coordinator_name is fixed at creation/.test(sql), true)
// Events created before the column existed have to end up with a name too, or
// the archive shows a blank filer for everything it already held.
check('sql: existing events are credited in the backfill',
  /update public\.events e[\s\S]*?set coordinator_name = p\.name[\s\S]*?coordinator_name is null/.test(sql), true)

// The client must not be able to send this value. fromEvent is a whitelist, so
// the omission is what enforces it, and eventInsertRow's Omit keeps a caller
// from satisfying the type by passing it anyway.
const mapperSrc = readFileSync(new URL('../src/supabase/mappers.ts', import.meta.url), 'utf8')
check('ts: the name is read back from the row', /coordinatorName: row\.coordinator_name/.test(mapperSrc), true)
check('ts: the name is never sent by the client',
  /put\('coordinator_name'/.test(mapperSrc), false)
check('ts: creating an event does not require a name',
  /Omit<CollegeEvent, 'createdAt' \| 'updatedAt' \| 'coordinatorName'>/.test(mapperSrc), true)

// Who filed an event is a fact about the archive, not a filter over it.
const dashboardSrc = readFileSync(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8')
const eventsSrc = readFileSync(new URL('../src/pages/Events.tsx', import.meta.url), 'utf8')
const hooksSrc = readFileSync(new URL('../src/hooks/useEvents.ts', import.meta.url), 'utf8')
// Matched on the props that render them rather than on the words, because the
// comments explaining the removal still have to name what was removed.
check('ui: the per-teacher My Events panel is gone',
  /title="My Events"/.test(dashboardSrc), false)
check('ui: the Only mine filter is gone', /value="mine"/.test(eventsSrc), false)
// isMine existed only to feed those two views, so nothing should be left
// computing it — otherwise the creator check is back in a place it does not
// belong.
check('ui: nothing compares an event against the signed-in user',
  /isMine/.test(dashboardSrc + eventsSrc + hooksSrc), false)
// The name is shown where an event is, for every event rather than only the
// viewer's own.
for (const [label, src] of [['cards', readFileSync(new URL('../src/components/EventCard.tsx', import.meta.url), 'utf8')],
                            ['details', readFileSync(new URL('../src/pages/EventDetails.tsx', import.meta.url), 'utf8')],
                            ['dashboard', dashboardSrc]]) {
  check(`ui: ${label} name the filer`, /coordinatorName/.test(src), true)
}

// ─── Media follows the same rule as the event it belongs to ─────────────────
// Uploads are keyed on the event id in the path, and a teacher who can edit an
// event must also be able to replace its cover photo and file its report. A rule
// that only matched the caller's own uid folder gave full access to the event
// record and none at all to its attachments.
const storageSrc = readFileSync(new URL('../src/supabase/storage.ts', import.meta.url), 'utf8')

check('sql: media writes are not limited to your own uid folder',
  /create policy event_media_(insert|update|delete)[\s\S]*?public\.manages_event_media\(name\)/.test(sql), true)
check('sql: department media access is checked on insert too',
  /create policy event_media_insert[\s\S]*?with check \([\s\S]*?manages_event_media/.test(sql), true)
check('sql: your own folder still works', /auth\.uid\(\)::text \|\| '\/%'/.test(sql), true)

// The event id has to be segment 2 of the path, and the uploader has to put it
// there. If either moves, media access silently reverts to your own folder.
check('sql: the event id is read from path segment 2',
  /split_part\(p_name, '\/', 2\)/.test(sql), true)
check('app: the event id is written to path segment 2',
  /`events\/\$\{eventId\}\/\$\{uid\}\//.test(storageSrc), true)

// A cast would raise on any non-uuid path and take the request down with it, so
// the id is compared as text.
check('sql: the event id is compared as text, never cast to uuid',
  /e\.id::text = split_part/.test(sql) && !/split_part\([^)]*\)::uuid/.test(sql), true)
check('sql: the media helper is not exposed to anon',
  /revoke execute on function public\.manages_event_media\(text\) from public, anon;/.test(sql), true)

// The bucket lets any signed-in teacher read every file, so a page that signs a
// whole event's media on arrival makes every teacher who looks at an event pull
// every photo and every report off storage. Only the cover is automatic, because
// the list shows it and a card without a picture is not a card.
const detailsSrc = readFileSync(new URL('../src/pages/EventDetails.tsx', import.meta.url), 'utf8')
check('app: the cover is signed on load', /useSignedUrl\(event\?\.coverImage\)/.test(detailsSrc), true)
check('app: the gallery is not signed on load',
  /useSignedUrls?\(event\?\.images/.test(detailsSrc), false)
check('app: the report is not signed on load',
  /useSignedUrl\(event\?\.report\)/.test(detailsSrc), false)
check('app: there is a signer for when someone actually asks',
  /export function useOnDemandSigner\(\)/.test(storageSrc), true)
// It hands back a URL and lets the page decide what a "See" does, so a photo can
// be drawn in its own tile while a report still goes to a new tab. A hook that
// opened the file itself would force one behaviour on both.
check('app: the signer returns the URL rather than opening it',
  /const sign = useCallback\(async \(path: string\): Promise<string \| null>/.test(storageSrc) &&
  !/window\.open/.test(storageSrc), true)
// Nothing in the media layer pulls a file: signing mints a URL, and the browser
// only asks for the bytes when something renders or opens it.
check('app: nothing fetches a file behind a render',
  !/fetch\(/.test(storageSrc) && !/new Image\(\)/.test(storageSrc), true)
// A gallery photo is loaded into its own tile, not opened over the page. The
// whole point of a grid is being able to look at it, and a dialog showing one
// image at a time puts that back to one press per photo. The full-size link is
// the deliberate way out, so nothing is lost.
check('app: a gallery photo is drawn inside its own tile',
  /const shown = media\.urls\[path\]/.test(detailsSrc) &&
  /<img[\s\S]*?src=\{shown\}/.test(detailsSrc), true)
check('app: no photo is opened over the page',
  /setPreview|role="dialog"/.test(detailsSrc), false)
// Once a photo is asked for it stays in its tile — there is no toggle back to
// the placeholder, and no second control to get wrong.
check('app: a loaded photo stays shown', /Hide/.test(detailsSrc), false)
// Signing is per tile, not per page: a second tile pressed while the first is
// still loading has to work, which a single `pending` slot would silently break.
check('app: loading state is tracked per path',
  /useState<Record<string, boolean>>\(\{\}\)/.test(storageSrc), true)
// The report is still a document rather than a picture, so it keeps going to a
// new tab — that is not the same decision as the gallery.
check('app: and the report is still handed to a new tab',
  /window\.open\(url, '_blank'/.test(detailsSrc), true)
// A hook that signs a whole list at once is the thing this replaces; it is named
// here so a future gallery cannot quietly reintroduce it.
check('app: nothing signs a list of paths in one pass',
  /useSignedUrls|Promise\.all\(list\.map/.test(storageSrc), false)

// ─── Form input ────────────────────────────────────────────────────────────
// The browser's own validation is not enough: `required` is satisfied by a run
// of spaces, and a number input hands back `1e3` or `3.5` that only Postgres
// rejects, as a cast error in a message nobody can act on. These are the rules
// CreateEvent and EditEvent both depend on.
const { validateEvent, checkImageFile, checkReportFile } = await server.ssrLoadModule('/src/lib/eventInput.ts')

const form = (over = {}) => ({
  title: 'Workshop',
  date: '2026-10-01',
  startTime: '10:00',
  endTime: '12:00',
  venue: 'Seminar Hall',
  description: 'A talk.',
  guestSpeaker: '',
  ...over,
})
const err = (over) => {
  const r = validateEvent(form(over))
  return r.ok ? null : r.error
}
const val = (over) => {
  const r = validateEvent(form(over))
  return r.ok ? r.value : `INVALID: ${r.error}`
}

check('input: a good event passes', validateEvent(form()).ok, true)
check('input: text is trimmed on the way in',
  [val({ title: '  Workshop  ' }).title, val({ venue: ' Hall ' }).venue], ['Workshop', 'Hall'])
check('input: an all-spaces title is not a title', !!err({ title: '    ' }), true)
check('input: an all-spaces venue is not a venue', !!err({ venue: '  ' }), true)
check('input: an over-long title is refused', !!err({ title: 'x'.repeat(200) }), true)

// Postgres would quietly store 3 March for this, and date-fns would then work
// from a date nobody typed.
check('input: 31 February is refused', !!err({ date: '2026-02-31' }), true)
check('input: 29 February is fine in a leap year', validateEvent(form({ date: '2024-02-29' })).ok, true)
check('input: 29 February is refused in a common year', !!err({ date: '2026-02-29' }), true)
check('input: a nonsense year is refused', !!err({ date: '0001-01-01' }), true)
check('input: a malformed date is refused', !!err({ date: '1 Oct 2026' }), true)

check('input: seconds are accepted and normalised',
  [val({ startTime: '09:30:00' }).startTime, val({ endTime: '12:00:45' }).endTime], ['09:30', '12:00'])
check('input: an out-of-range hour is refused', !!err({ startTime: '25:00' }), true)
check('input: the end must be after the start', !!err({ endTime: '09:00' }), true)
check('input: equal start and end is refused', !!err({ endTime: '10:00' }), true)

check('input: a blank speaker means none', val().guestSpeaker, null)
check('input: a speaker is trimmed', val({ guestSpeaker: ' Dr Rao ' }).guestSpeaker, 'Dr Rao')

// `accept="image/*"` is only a hint; a renamed file gets through.
check('input: a non-image cover is refused', checkImageFile({ name: 'notes.txt', type: 'text/plain' }).ok, false)
check('input: an image cover is allowed', checkImageFile({ name: 'a.png', type: 'image/png' }).ok, true)

// A report is a write-up, so documents count as well as photos of one. Matched
// on the extension too, because Word files often arrive with an empty type.
const report = (name, type) => checkReportFile({ name, type }).ok
check('input: a PDF report is allowed', report('writeup.pdf', 'application/pdf'), true)
check('input: a .docx with no MIME type is allowed', report('writeup.docx', ''), true)
check('input: a text report is allowed', report('notes.txt', 'text/plain'), true)
check('input: a photo of a report is allowed', report('page1.jpg', 'image/jpeg'), true)
check('input: an arbitrary file is not a report', report('virus.exe', 'application/octet-stream'), false)
check('input: a PDF is not an image', report('writeup.pdf', 'application/pdf') && !checkImageFile({ name: 'w.pdf', type: 'application/pdf' }).ok, true)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
await server.close()
process.exit(failed === 0 ? 0 : 1)
