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
    status: 'upcoming',
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
const { resolveStatus, planStatusSync, REPORT_GRACE_DAYS, eventEnd } = await server.ssrLoadModule('/src/lib/eventStatus.ts')
const eventEndMs = (e) => eventEnd(e).getTime()
const { isEventOwner } = await server.ssrLoadModule('/src/lib/ownership.ts')

const now = new Date()

// --- lifecycle ---
const future = ev({ date: dateOffset(5) })
check('future event -> upcoming', resolveStatus(future, now).status, 'upcoming')

const today = ev({ date: dateOffset(0), startTime: '00:00', endTime: '23:59' })
check('spanning now -> ongoing', resolveStatus(today, now).status, 'ongoing')

const pastNoReport = ev({ date: dateOffset(-1) })
check('ended yesterday, no report -> completed', resolveStatus(pastNoReport, now).status, 'completed')
check('ended yesterday, no report -> pendingReport true', resolveStatus(pastNoReport, now).pendingReport, true)

const pastWithReport = ev({ date: dateOffset(-1), report: 'https://x/r.pdf' })
check('ended yesterday, has report -> completed', resolveStatus(pastWithReport, now).status, 'completed')
check('ended yesterday, has report -> not pending', resolveStatus(pastWithReport, now).pendingReport, false)

const stale = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)) })
const staleRes = resolveStatus(stale, now)
check('ended 10d ago, no report -> cancelled', staleRes.status, 'cancelled')
check('ended 10d ago -> reason no_report', staleRes.reason, 'no_report')
check('ended 10d ago -> autoCancelled true', staleRes.autoCancelled, true)

const staleWithReport = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), report: 'https://x/r.pdf' })
check('ended 10d ago, has report -> completed', resolveStatus(staleWithReport, now).status, 'completed')

check('ended 6d ago, no report -> completed (inside grace)', resolveStatus(ev({ date: dateOffset(-6) }), now).status, 'completed')
check('ended 8d ago, no report -> cancelled (outside grace)', resolveStatus(ev({ date: dateOffset(-8) }), now).status, 'cancelled')

// Exact boundary: an event ending precisely 7 days before the reference instant.
function endsExactlyDaysAgo(days) {
  const t = new Date(now.getTime() - days * DAY)
  const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return ev({ date, startTime: hhmm, endTime: hhmm })
}
const boundary = endsExactlyDaysAgo(REPORT_GRACE_DAYS)
// grace expires AT end + 7 days, so compare around that instant directly.
const graceEnd = new Date(eventEndMs(boundary) + REPORT_GRACE_DAYS * DAY)
check('1 min before grace end -> completed',
  resolveStatus(boundary, new Date(graceEnd.getTime() - 60000)).status, 'completed')
check('at grace end -> cancelled',
  resolveStatus(boundary, graceEnd).status, 'cancelled')
check('1 min after grace end -> cancelled',
  resolveStatus(boundary, new Date(graceEnd.getTime() + 60000)).status, 'cancelled')

// --- manual cancel is sticky ---
const manual = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), status: 'cancelled', cancelledReason: 'manual' })
const manualRes = resolveStatus(manual, now)
check('manual cancel sticky -> cancelled', manualRes.status, 'cancelled')
check('manual cancel sticky -> not auto', manualRes.autoCancelled, false)

// --- legacy cancellation: cancelled before the reason field existed ---
// Auto-cancellation did not exist back then, so these were all cancelled by
// hand and must not spring back to their date-derived status.
const legacyPast = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), status: 'cancelled' })
const legacyFuture = ev({ date: dateOffset(30), status: 'cancelled' })
check('legacy cancel (past) stays cancelled', resolveStatus(legacyPast, now).status, 'cancelled')
check('legacy cancel (past) reads as manual', resolveStatus(legacyPast, now).reason, 'manual')
check('legacy cancel (future) stays cancelled', resolveStatus(legacyFuture, now).status, 'cancelled')
check('legacy cancel (future) reads as manual', resolveStatus(legacyFuture, now).reason, 'manual')
check('sync: legacy cancel backfills reason, keeps status',
  planStatusSync([legacyFuture], 'teacher-1', now).map(p => [p.status, p.cancelledReason]).flat().join(),
  'cancelled,manual')
check('explicit no_report still defers to the lifecycle',
  resolveStatus({ ...ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), status: 'cancelled', report: 'R.pdf' }), cancelledReason: 'no_report' }, now).status,
  'completed')

// --- uploading a report onto an auto-cancelled event completes it ----------
// The upload clears cancelledReason but the stored status can still read
// 'cancelled'. That must not be mistaken for a manual cancellation, or the
// event could never be closed off.
const autoCancelled = ev({ date: dateOffset(-(REPORT_GRACE_DAYS + 3)), status: 'cancelled', cancelledReason: 'no_report' })
const afterUpload = { ...autoCancelled, report: 'R.pdf', cancelledReason: null, status: 'cancelled' }
check('report on auto-cancelled event -> completed', resolveStatus(afterUpload, now).status, 'completed')
check('report on auto-cancelled event -> not manual', resolveStatus(afterUpload, now).reason, null)
check('report on auto-cancelled event -> not pending', resolveStatus(afterUpload, now).pendingReport, false)
check('sync after upload: status corrected to completed',
  planStatusSync([afterUpload], 'teacher-1', now).map(p => p.status).join(), 'completed')
check('sync after upload: reason stays cleared',
  planStatusSync([afterUpload], 'teacher-1', now).map(p => String(p.cancelledReason)).join(), 'null')
check('uploaded event needs no further sync',
  planStatusSync([{ ...afterUpload, status: 'completed' }], 'teacher-1', now).length, 0)
check('manual cancel with a report still resolves from the date',
  resolveStatus({ ...ev({ date: dateOffset(-2), status: 'cancelled', cancelledReason: 'manual', report: 'R.pdf' }), cancelledReason: 'manual' }, now).status,
  'completed')

// --- planStatusSync ---
check('sync: nothing to do when stored matches',
  planStatusSync([{ ...stale, status: 'cancelled', cancelledReason: 'no_report' }], 'teacher-1', now).length, 0)
check('sync: needs patch when stale',
  planStatusSync([stale], 'teacher-1', now).length, 1)
const patch = planStatusSync([stale], 'teacher-1', now)[0]
check('sync: patch status', patch.status, 'cancelled')
check('sync: patch reason', patch.cancelledReason, 'no_report')
check('sync: patch sets cancelledAt', patch.cancelledAt !== null, true)
check('sync: never touches other teachers events',
  planStatusSync([stale], 'someone-else', now).length, 0)
check('sync: no uid -> no work', planStatusSync([stale], null, now).length, 0)
check('sync: manual cancel never patched',
  planStatusSync([manual], 'teacher-1', now).length, 0)
check('sync: future event not patched',
  planStatusSync([{ ...future, status: 'upcoming' }], 'teacher-1', now).length, 0)

// --- ownership ---
check('owner owns event', isEventOwner(ev(), 'teacher-1'), true)
check('non-owner does not', isEventOwner(ev(), 'teacher-2'), false)
check('null uid does not', isEventOwner(ev(), null), false)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
await server.close()
process.exit(failed === 0 ? 0 : 1)
