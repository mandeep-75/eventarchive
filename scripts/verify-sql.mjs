// Executes supabase/schema.sql against a real Postgres and asserts what it
// actually does. scripts/verify-lifecycle.mjs checks the same file as text,
// which cannot tell you whether a policy is correct — only that it is written
// the way it was written. This one runs it.
//
// The interesting case is manages_event_media(), which is the first policy here
// to read another table from inside a storage policy. Whether that works, and
// whether the `revoke … from public` leaves `authenticated` able to call it at
// all, are both questions only a real database can answer.
//
// Needs a Postgres 15+ server. Skips (exit 0) without one, like smoke-ui.mjs.
// Nothing is installed and no existing cluster is touched: a throwaway cluster
// is created in a temp directory and destroyed on the way out.
//
//   brew install postgresql@17
//   node scripts/verify-sql.mjs
//
// Override discovery with PG_BIN=/path/to/postgresql@17/bin.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── Find a server ─────────────────────────────────────────────────────────
// `brew --prefix` prints a path whether or not the formula is installed, so the
// candidate is checked rather than trusted.
function findBin(name) {
  if (process.env.PG_BIN) {
    const p = join(process.env.PG_BIN, name)
    if (existsSync(p)) return p
  }
  for (const v of ['18', '17', '16', '15']) {
    const brew = spawnSync('brew', ['--prefix', `postgresql@${v}`], { encoding: 'utf8' })
    if (brew.status !== 0) continue
    const p = join(brew.stdout.trim(), 'bin', name)
    if (existsSync(p)) return p
  }
  const which = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : null
}

const PSQL = findBin('psql')
const INITDB = findBin('initdb')
const PG_CTL = findBin('pg_ctl')
const CREATEDB = findBin('createdb')
if (!PSQL || !INITDB || !PG_CTL || !CREATEDB) {
  console.log('SKIP  no Postgres found — set PG_BIN, or `brew install postgresql@17`')
  process.exit(0)
}

// A socket in a temp dir rather than a TCP port, so a harness run can never
// collide with a cluster you already have listening. The two live in separate
// directories because initdb insists on being handed an empty one.
const root = mkdtempSync(join(tmpdir(), 'ea-pg-'))
const dir = join(root, 'data')
const sock = join(root, 'sock')
const log = join(root, 'log')
mkdirSync(sock)
const DB = 'eventarchive'

function run(bin, args, input) {
  const r = spawnSync(bin, args, { input, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

function sql(text) {
  const r = run(PSQL, ['-h', sock, '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-tAqX', '-f', '-'], text)
  // A cluster that has died otherwise turns into a run of confusing empty
  // results, one per remaining check. Stop at the first one and say so.
  if (!r.ok && /No such file or directory|could not connect/.test(r.err)) {
    throw new Error(`the test cluster stopped responding\n${logTail()}`)
  }
  return r
}

/** The last few lines of the server log, for when something goes wrong. */
function logTail() {
  if (!existsSync(log)) return '(no log)'
  return readFileSync(log, 'utf8').trim().split('\n').slice(-12).join('\n')
}

/** Runs statements as a signed-in teacher, rolled back so tests cannot leak into each other. */
function asUser(uid, statements) {
  return asRole(uid, statements, 'rollback')
}

/**
 * The same, but committed, for the cases where the point is whether the write
 * actually landed. RLS filters rows out of an UPDATE or DELETE silently — the
 * statement matches nothing and still exits 0 — so a refusal can only be shown
 * by reading the row back, not by the exit status.
 */
function asUserCommit(uid, statements) {
  return asRole(uid, statements, 'commit')
}

function asRole(uid, statements, finish) {
  const claims = `'${JSON.stringify({ sub: uid })}'`
  return sql(`begin;
set local role authenticated;
set local request.jwt.claims = ${claims};
${statements}
${finish};`)
}

function asAnon(statements) {
  return sql(`begin;
set local role anon;
${statements}
rollback;`)
}

let failed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`)
}

// What a statement did, as one of a few words. The point is telling a refusal
// apart from a crash: a policy that denies is correct, but a function that
// raises invalid_input_syntax on a malformed path is the bug this file went to
// some trouble to avoid.
const DENIED = 'DENIED'
function outcome(result) {
  if (result.ok) return 'ALLOWED'
  if (/row-level security/i.test(result.err)) return DENIED
  return 'ERROR'
}
const firstLine = (s) => s.split('\n')[0]

// ─── Fixtures ──────────────────────────────────────────────────────────────
const DEPT_A = 'd1111111-1111-1111-1111-111111111111'
const DEPT_B = 'd2222222-2222-2222-2222-222222222222'
const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' // owns the event
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' // colleague, same department
const CAROL = 'cccccccc-cccc-cccc-cccc-cccccccccccc' // another department
const DAVE = 'dddddddd-dddd-dddd-dddd-dddddddddddd' // no department
const EVENT_A = 'e1111111-1111-1111-1111-111111111111'
const EVENT_B = 'e2222222-2222-2222-2222-222222222222'

const inEventA = (uid) => `events/${EVENT_A}/${uid}/cover/photo.png`

let clusterUp = false
try {
  const init = run(INITDB, ['-D', dir, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '--no-sync'])
  if (!init.ok) {
    console.log(`SKIP  initdb failed — ${firstLine(init.err)}`)
    process.exit(0)
  }
  // Durability is pointless for a cluster that is about to be deleted, and
  // turning it off is the difference between this taking a second and a minute.
  const start = run(PG_CTL, ['-D', dir, '-l', log, '-w', '-o',
    `-k ${sock} -c listen_addresses= -c fsync=off -c full_page_writes=off -c synchronous_commit=off`, 'start'])
  if (!start.ok) {
    const detail = existsSync(log) ? firstLine(readFileSync(log, 'utf8')) : firstLine(start.err)
    console.log(`SKIP  could not start Postgres — ${detail}`)
    process.exit(0)
  }
  clusterUp = true
  run(CREATEDB, ['-h', sock, '-U', 'postgres', DB])

  const stubs = join(import.meta.dirname, 'sql', 'stubs.sql')
  const schema = join(import.meta.dirname, '..', 'supabase', 'schema.sql')
  const resetSql = join(import.meta.dirname, '..', 'supabase', 'reset.sql')
  const must = (text, what) => {
    const r = sql(text)
    if (!r.ok) throw new Error(`${what} failed: ${firstLine(r.err)}`)
    return r
  }
  must(readFileSync(stubs, 'utf8'), 'stubs.sql')
  must(readFileSync(schema, 'utf8'), 'schema.sql')
  // Read here but deliberately NOT executed: reset.sql drops the tables, so it
  // can only run in the reset section below, once there is a seed to lose.
  const resetSource = readFileSync(resetSql, 'utf8')
  // Guards the file's whole purpose, since nothing else here would notice a
  // future edit quietly removing the drops.
  if (!/drop table if exists public\.events/.test(resetSource)) {
    throw new Error('reset.sql no longer drops public.events')
  }

  // Supabase grants these to both roles on every table by default. RLS is what
  // decides access, and without the grants every request would be refused for a
  // reason that has nothing to do with the policies under test.
  sql('grant usage on schema public, storage to anon, authenticated;')
  sql('grant all on all tables in schema public, storage to anon, authenticated;')

  // must(), not sql(): a seed that fails quietly turns every check after it
  // into a meaningless empty result rather than an error.
  must(`
    -- raw_user_meta_data is what the sign-up form writes, and the profile
    -- backfill reads it. Only ALICE has one, so the fallback can be tested too.
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ALICE}', 'a@x.edu', '{"full_name":"Alice Adams"}'::jsonb),
      ('${BOB}', 'bob@x.edu', '{}'::jsonb),
      ('${CAROL}', 'c@x.edu', '{}'::jsonb),
      ('${DAVE}', 'd@x.edu', '{}'::jsonb);
    insert into public.departments (id, name) values
      ('${DEPT_A}', 'Physics'), ('${DEPT_B}', 'Chemistry');
    insert into public.profiles (id, name, email, department_id) values
      ('${ALICE}', 'Alice', 'a@x.edu', '${DEPT_A}'),
      ('${BOB}', 'Bob', 'b@x.edu', '${DEPT_A}'),
      ('${CAROL}', 'Carol', 'c@x.edu', '${DEPT_B}'),
      ('${DAVE}', 'Dave', 'd@x.edu', null);
    insert into public.events
      (id, title, department_id, event_date, start_time, end_time, venue, coordinator_id, updated_at)
    values
      ('${EVENT_A}', 'Lecture', '${DEPT_A}', current_date, '10:00', '12:00', 'Hall', '${ALICE}', '2020-01-01'),
      ('${EVENT_B}', 'Lab', '${DEPT_B}', current_date, '10:00', '12:00', 'Room', '${CAROL}', '2020-01-01');
  `, 'seed data')

  // ─── manages_event_media ────────────────────────────────────────────────
  // The whole point of the change: a colleague in the owning department can
  // reach the event's media, and nobody else can.
  const call = (uid, path) => asUser(uid, `select public.manages_event_media('${path}');`).out
  check('media: the department that owns the event', call(ALICE, inEventA(ALICE)), 't')
  check('media: a colleague in that department', call(BOB, inEventA(ALICE)), 't')
  check('media: a colleague writing into the owner\'s folder', call(BOB, inEventA(ALICE)), 't')
  check('media: another department', call(CAROL, inEventA(ALICE)), 'f')
  check('media: their own event', call(CAROL, `events/${EVENT_B}/${CAROL}/cover/photo.png`), 't')
  check('media: a teacher with no department', call(DAVE, inEventA(ALICE)), 'f')

  // The event id is compared as text, so a path that is not an event id has to
  // come back false rather than raise. An invalid_input_syntax here would take
  // down every request that happens to touch a non-event path.
  check('media: a non-uuid segment is false, not an error', call(ALICE, 'events/not-a-uuid/x/cover/photo.png'), 'f')
  check('media: a path with too few segments is false', call(ALICE, 'garbage'), 'f')
  check('media: an empty path is false', call(ALICE, ''), 'f')
  check('media: a uuid that is not an event is false', call(ALICE, 'events/f1111111-1111-1111-1111-111111111111/x/f.png'), 'f')
  check('media: the event id must be segment 2, not another', call(ALICE, `${ALICE}/events/${EVENT_A}/cover/p.png`), 'f')

  // Revoking EXECUTE from PUBLIC also removes it from every role that had it
  // only by way of PUBLIC — which includes authenticated. If the function were
  // left uncallable the storage policies below would still compile and then fail
  // at runtime with "permission denied for function" on every upload, so the
  // privilege is asserted directly rather than inferred from the policies.
  check('media: authenticated can execute the helper',
    sql(`select has_function_privilege('authenticated', 'public.manages_event_media(text)', 'EXECUTE');`).out, 't')
  check('media: anon cannot execute the helper',
    sql(`select has_function_privilege('anon', 'public.manages_event_media(text)', 'EXECUTE');`).out, 'f')
  const anonCall = asAnon(`select public.manages_event_media('${inEventA(ALICE)}');`)
  check('media: anon calling it is refused', /permission denied/i.test(anonCall.err), true)

  // ─── Storage policies ───────────────────────────────────────────────────
  const insert = (uid, path) => outcome(asUser(uid, `insert into storage.objects (bucket_id, name) values ('event-media', '${path}');`))
  check('storage: your own folder', insert(ALICE, inEventA(ALICE)), 'ALLOWED')
  check('storage: a colleague writing the same event\'s media', insert(BOB, inEventA(ALICE)), 'ALLOWED')
  check('storage: a colleague in their own folder', insert(BOB, inEventA(BOB)), 'ALLOWED')
  check('storage: another department', insert(CAROL, inEventA(ALICE)), DENIED)
  check('storage: a non-uuid path is refused, not an error', insert(ALICE, 'events/not-a-uuid/x/cover/p.png'), DENIED)
  check('storage: another bucket', insert(ALICE, 'other/x.png'), DENIED)
  check('storage: anon cannot write', outcome(asAnon(`insert into storage.objects (bucket_id, name) values ('event-media', '${inEventA(ALICE)}');`)), DENIED)

  // ─── Reading media ───────────────────────────────────────────────────────
  // The bucket's read policy is managers-only, and a signed URL is minted only
  // for a caller that policy lets see the object — so this one policy is the
  // entire read boundary. There is no second check elsewhere to fall back on.
  const photoPath = `events/${EVENT_A}/${ALICE}/images/pic.png`
  const seedPhoto = () => {
    sql(`delete from storage.objects where name = '${photoPath}';`)
    sql(`insert into storage.objects (bucket_id, name) values ('event-media', '${photoPath}');`)
  }
  const photoRows = () =>
    sql(`select count(*) from storage.objects where name = '${photoPath}';`).out
  const photoOwner = () =>
    sql(`select coalesce(owner::text, 'none') from storage.objects where name = '${photoPath}';`).out
  const reads = (uid) =>
    asUser(uid, `select count(*) from storage.objects where name = '${photoPath}';`).out

  seedPhoto()
  // A select is filtered rather than refused, so an empty result is the denial.
  check('storage: the uploader cannot read their own photo back', reads(ALICE), '0')
  check('storage: a colleague cannot read it either', reads(BOB), '0')
  check('storage: another department cannot read it', reads(CAROL), '0')
  check('storage: anon cannot read media',
    asAnon(`select count(*) from storage.objects where name = '${photoPath}';`).out, '0')

  // Reading and writing are not independent. A DELETE with a WHERE clause reads
  // the row it deletes, and so does an overwrite; both need this select policy
  // on top of their own. That is why a non-manager who may insert is refused
  // here, and why no upload path in the app is ever written twice. The upload
  // half stays open, which is the whole point — the checks below keep "teachers
  // can upload" from being read as "teachers can manage the files".
  seedPhoto()
  asUserCommit(ALICE, `delete from storage.objects where name = '${photoPath}';`)
  check('storage: a non-manager cannot delete a photo', photoRows(), '1')
  seedPhoto()
  asUserCommit(BOB, `delete from storage.objects where name = '${photoPath}';`)
  check('storage: a colleague in the owning department cannot either', photoRows(), '1')
  seedPhoto()
  asUserCommit(CAROL, `delete from storage.objects where name = '${photoPath}';`)
  check('storage: another department cannot delete a photo', photoRows(), '1')
  seedPhoto()
  asUserCommit(ALICE, `update storage.objects set owner = '${ALICE}' where name = '${photoPath}';`)
  check('storage: a non-manager cannot overwrite a photo', photoOwner(), 'none')

  // The statement storage runs for an upsert, against the constraint it runs it
  // against. Supabase's own docs: overwriting a file needs SELECT and UPDATE as
  // well as INSERT. This is the case that decides how the app uploads — a fixed
  // cover path written twice would land exactly here and fail for every
  // non-manager, which is why every file name carries a timestamp instead.
  seedPhoto()
  check('storage: a non-manager upserting an existing file is refused',
    outcome(asUser(ALICE, `insert into storage.objects (bucket_id, name)
      values ('event-media', '${photoPath}')
      on conflict (bucket_id, name) do update set owner = '${ALICE}';`)),
    DENIED)

  // The delete and update policies themselves are unchanged and still name the
  // owning department, so a manager exercises them: BOB is in DEPT_A, which
  // owns EVENT_A, and would pass without is_manager if select allowed him.
  sql(`update public.profiles set is_manager = true where id = '${BOB}';`)
  check('storage: a manager can read media', reads(BOB), '1')
  seedPhoto()
  asUserCommit(BOB, `delete from storage.objects where name = '${photoPath}';`)
  check('storage: a manager in the owning department can delete', photoRows(), '0')
  seedPhoto()
  asUserCommit(BOB, `update storage.objects set owner = '${BOB}' where name = '${photoPath}';`)
  check('storage: a manager can overwrite', photoOwner(), BOB)
  sql(`update public.profiles set is_manager = false where id = '${BOB}';`)
  sql(`delete from storage.objects where name = '${photoPath}';`)

  // ─── Events ─────────────────────────────────────────────────────────────
  // Each case writes a distinct title, so reading the title back says exactly
  // which caller got through.
  const titledBy = (uid, title) => {
    asUserCommit(uid, `update public.events set title = '${title}' where id = '${EVENT_A}';`)
    return sql(`select title from public.events where id = '${EVENT_A}';`).out
  }
  check('events: a colleague can edit', titledBy(BOB, 'by-bob'), 'by-bob')
  check('events: the owner can edit', titledBy(ALICE, 'by-alice'), 'by-alice')
  check('events: another department cannot', titledBy(CAROL, 'by-carol'), 'by-alice')
  check('events: a teacher with no department cannot', titledBy(DAVE, 'by-dave'), 'by-alice')
  // using alone would allow this: the row is visible while it sits in the
  // caller's department, and the with check is what refuses the move. Unlike a
  // read, this one does raise, because the row is being rewritten.
  // Refused by the pin trigger, which runs before the policy's with check gets
  // a look. The with check is the second line of defence here, not the only one.
  const move = asUser(BOB, `update public.events set department_id = '${DEPT_B}' where id = '${EVENT_A}';`)
  check('events: it cannot be moved to another department',
    [outcome(move), /department_id is fixed/.test(move.err)], ['ERROR', true])

  // Pinned by trigger, which sees OLD and NEW. The policy leaves
  // coordinator_id writable on purpose, so this one is the trigger's job.
  const handoff = asUser(BOB, `update public.events set coordinator_id = '${CAROL}' where id = '${EVENT_A}';`)
  check('events: it cannot be handed to another teacher',
    [outcome(handoff), /coordinator_id is fixed/.test(handoff.err)], ['ERROR', true])

  // The trigger stamps updated_at so a caller cannot forget to.
  sql(`update public.events set updated_at = '2020-01-01' where id = '${EVENT_A}';`)
  asUserCommit(BOB, `update public.events set title = 'Stamped' where id = '${EVENT_A}';`)
  check('events: updated_at is stamped on write',
    sql(`select (updated_at = '2020-01-01') from public.events where id = '${EVENT_A}';`).out, 'f')

  const ins = (uid, coordinator, dept) =>
    outcome(asUser(uid, `insert into public.events
      (title, department_id, event_date, start_time, end_time, venue, coordinator_id)
      values ('New', '${dept}', current_date, '10:00', '12:00', 'Hall', '${coordinator}');`))
  check('events: you can file under your own department', ins(BOB, BOB, DEPT_A), 'ALLOWED')
  check('events: you cannot file on someone else\'s behalf', ins(BOB, ALICE, DEPT_A), DENIED)
  check('events: you cannot file into another department', ins(CAROL, CAROL, DEPT_A), DENIED)
  check('events: a teacher with no department cannot file', ins(DAVE, DAVE, DEPT_A), DENIED)

  // ─── Reads ──────────────────────────────────────────────────────────────
  check('read: any signed-in teacher sees every event', asUser(CAROL, 'select count(*) from public.events;').out, '2')
  check('read: a profile is not another teacher\'s to list', asUser(BOB, 'select count(*) from public.profiles;').out, '1')
  sql(`update public.profiles set is_manager = true where id = '${BOB}';`)
  check('read: a manager sees every profile', asUser(BOB, 'select count(*) from public.profiles;').out, '4')
  sql(`update public.profiles set is_manager = false where id = '${BOB}';`)
  check('read: anon sees no events at all', asAnon('select count(*) from public.events;').out, '0')
  check('read: anon sees no profiles at all', asAnon('select count(*) from public.profiles;').out, '0')

  // ─── Shape ──────────────────────────────────────────────────────────────
  check('shape: events has no status column',
    sql(`select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'events' and column_name = 'status';`).out, '0')
  check('shape: the bucket is private',
    sql(`select public from storage.buckets where id = 'event-media';`).out, 'f')

  // MAX_BYTES in the uploader and file_size_limit on the bucket are two halves
  // of one rule, in two files that never see each other.
  const maxBytes = Number(/const MAX_BYTES = (\d+) \* (\d+) \* (\d+)/.exec(
    readFileSync(join(import.meta.dirname, '..', 'src', 'supabase', 'storage.ts'), 'utf8'))
    .slice(1, 4).reduce((a, n) => a * Number(n), 1))
  check('shape: the upload limit matches the bucket limit',
    [sql(`select file_size_limit from storage.buckets where id = 'event-media';`).out, maxBytes], ['10485760', 10485760])

  // A new public table is switched to RLS as it is created, so forgetting is
  // the safe direction. It also needs the table grants Supabase hands out by
  // default, or the read below would be refused for the wrong reason.
  sql('create table public.scratch_probe (id int);')
  sql('grant all on public.scratch_probe to anon, authenticated;')
  check('shape: a new public table is given RLS',
    sql(`select relrowsecurity from pg_class where relname = 'scratch_probe';`).out, 't')
  check('shape: …and is empty rather than open',
    asUser(ALICE, 'select count(*) from public.scratch_probe;').out, '0')

  // ─── Re-runnable ────────────────────────────────────────────────────────
  // schema.sql is pasted into the SQL editor over an existing database, so
  // running it twice has to be a no-op. NOTICEs on stderr are fine — "relation
  // already exists, skipping" is the guard doing its job — so only an ERROR
  // counts against it.
  const again = sql(readFileSync(schema, 'utf8'))
  check('rerun: applying the schema twice is clean',
    [again.ok, /ERROR/.test(again.err)], [true, false])
  check('rerun: the policies still work afterwards', titledBy(BOB, 'after-rerun'), 'after-rerun')
  check('rerun: no duplicate policy', sql(`
    select count(*) from pg_policies
    where tablename = 'events' and policyname = 'events_update';`).out, '1')

  // ─── Created by ─────────────────────────────────────────────────────────
  // profiles_select only lets a teacher read their own row, so "who created
  // this" is not answerable from the client and the name is copied onto the
  // event at creation. The part that matters is that it cannot be forged.
  check('created-by: an event records the filer\'s name',
    sql(`select coordinator_name from public.events where id = '${EVENT_A}';`).out, 'Alice')
  check('created-by: a second filer gets their own name, not the first',
    sql(`
      select coordinator_name from public.events
      where id = '${EVENT_B}';`).out, 'Carol')

  // Committed, because the point is what actually landed in the row — and
  // `asUser` rolls back, so a read-back would find nothing at all.
  const spoof = asUserCommit(BOB, `
    insert into public.events
      (title, department_id, event_date, start_time, end_time, venue, coordinator_id, coordinator_name)
    values
      ('Spoofed', '${DEPT_A}', current_date, '10:00', '11:00', 'Hall', '${BOB}', 'Alice');`)
  check('created-by: the insert itself is allowed', spoof.ok, true)
  check('created-by: a caller cannot claim someone else\'s name',
    sql(`select coordinator_name from public.events where title = 'Spoofed';`).out, 'Bob')
  check('created-by: a teacher still cannot file under another department',
    asUser(BOB, `
      insert into public.events
        (title, department_id, event_date, start_time, end_time, venue, coordinator_id)
      values ('Nope', '${DEPT_B}', current_date, '10:00', '11:00', 'Hall', '${BOB}');`).ok, false)
  check('created-by: an anonymous visitor cannot file anything',
    asAnon(`
      insert into public.events
        (title, department_id, event_date, start_time, end_time, venue, coordinator_id, coordinator_name)
      values ('Anon', '${DEPT_A}', current_date, '10:00', '11:00', 'Hall', '${ALICE}', 'Alice');`).ok, false)

  // Insert-only on purpose: a later edit by the department must not silently
  // rewrite who an archived event is credited to.
  asUserCommit(BOB, `update public.events set title = 'Renamed' where title = 'Spoofed';`)
  check('created-by: a later edit leaves the name alone',
    sql(`
      select coordinator_name || ' / ' || title from public.events
      where title = 'Renamed';`).out, 'Bob / Renamed')
  check('created-by: a name that is already there cannot be rewritten',
    asUser(BOB, `update public.events set coordinator_name = 'Someone Else' where title = 'Renamed';`).ok,
    false)
  check('created-by: …and the row still reads Bob',
    sql(`select coordinator_name from public.events where title = 'Renamed';`).out, 'Bob')
  // Filling a missing one is allowed on purpose: the backfill has to credit
  // events that predate the column, and a special path for that would be worse
  // than letting a null be filled once.
  sql(`
    update public.events set coordinator_name = null where title = 'Renamed';
    update public.events set coordinator_name = 'Bob' where title = 'Renamed';`)
  check('created-by: a missing name may be filled in',
    sql(`select coordinator_name from public.events where title = 'Renamed';`).out, 'Bob')

  sql(`delete from public.events where title = 'Renamed';`)

  // ─── Reset ──────────────────────────────────────────────────────────────
  // The drop lives in supabase/reset.sql rather than in schema.sql, precisely so
  // that an ordinary paste cannot destroy anything. That separation is only worth
  // anything if it holds, so the first two checks here are about schema.sql
  // leaving the seeded data alone.
  check('reset: a routine schema paste leaves the data alone',
    sql('select count(*) from public.events;').out, '2')
  check('reset: and leaves the profiles alone',
    sql('select count(*) from public.profiles;').out, '4')

  // Run the way a person runs it: reset.sql, then schema.sql. Asserted as two
  // steps on purpose — if the drops only ever worked when pasted in the other
  // order, the instructions in the file would be lying.
  const reset = sql(resetSource)
  check('reset: reset.sql on its own is clean',
    [reset.ok, /ERROR/.test(reset.err)], [true, false])
  check('reset: the tables are gone before the schema is re-pasted',
    sql(`select coalesce(to_regclass('public.events')::text, 'none');`).out, 'none')
  const rebuilt = sql(readFileSync(schema, 'utf8'))
  check('reset: schema.sql then rebuilds them',
    [rebuilt.ok, /ERROR/.test(rebuilt.err)], [true, false])
  check('reset: the app tables were dropped and rebuilt',
    sql(`
      select string_agg(c.relname, ',' order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('events','profiles','departments');
    `).out, 'departments,events,profiles')
  check('reset: the old events are gone', sql('select count(*) from public.events;').out, '0')
  check('reset: the old departments are gone', sql('select count(*) from public.departments;').out, '0')
  check('reset: the accounts were NOT dropped', sql('select count(*) from auth.users;').out, '4')

  // The whole reason there is a backfill. A surviving account with no profile
  // makes is_manager() and my_department() answer null, so the person is
  // refused everywhere with nothing on screen to say why.
  check('reset: every surviving account has a profile again',
    sql('select count(*) from public.profiles;').out, '4')
  check('reset: the name comes from the sign-up metadata',
    sql(`select name from public.profiles where id = '${ALICE}';`).out, 'Alice Adams')
  check('reset: an account with no metadata falls back to its address',
    sql(`select name from public.profiles where id = '${BOB}';`).out, 'bob')
  check('reset: nobody is in a department until a manager places them',
    sql('select count(*) from public.profiles where department_id is not null;').out, '0')

  // A rebuild that lost RLS or the trigger would pass every assertion above and
  // then hand out the whole table.
  check('reset: RLS is back on the rebuilt tables',
    sql(`
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('events','profiles','departments')
        and c.relrowsecurity;
    `).out, '3')
  check('reset: the immutability trigger is back',
    sql("select count(*) from pg_trigger where tgname = 'events_pin_immutable';").out, '1')
  check('reset: the policies are back',
    sql("select count(*) from pg_policies where schemaname = 'public' and tablename = 'events';").out, '4')

  // A new table has no grants of its own, so this is where a rebuild goes wrong
  // silently: RLS on, policies correct, and every request refused for want of a
  // table privilege.
  check('reset: the rebuilt tables are granted to the app roles',
    sql(`
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated'
        and table_name in ('events','profiles','departments') and privilege_type = 'SELECT';
    `).out, '3')
  check('reset: a signed-in teacher can actually read one',
    asUser(ALICE, 'select count(*) from public.events;').out, '0')

  // The backfill must not be able to undo a manager's work on a routine paste.
  sql(`update public.profiles set name = 'Alice Renamed' where id = '${ALICE}';`)
  sql(readFileSync(schema, 'utf8'))
  check('reset: a later paste does not overwrite a profile that already exists',
    sql(`select name from public.profiles where id = '${ALICE}';`).out, 'Alice Renamed')

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
} catch (err) {
  console.log(`\nHARNESS ERROR  ${err.message}`)
  failed++
} finally {
  if (clusterUp) run(PG_CTL, ['-D', dir, '-m', 'immediate', '-w', 'stop'])
  rmSync(root, { recursive: true, force: true })
}

process.exit(failed === 0 ? 0 : 1)
