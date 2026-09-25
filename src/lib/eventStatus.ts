import { addDays, isValid, parse } from 'date-fns'
import type { CancelReason, CollegeEvent, EventStatus } from '../types'

/** Days after an event ends during which a report can still be submitted. */
export const REPORT_GRACE_DAYS = 7

const DATE_TIME_FORMAT = 'yyyy-MM-dd HH:mm'

/** Local-time start of the event. */
export function eventStart(event: Pick<CollegeEvent, 'date' | 'startTime'>): Date {
  return parse(
    `${event.date} ${event.startTime || '00:00'}`,
    DATE_TIME_FORMAT,
    new Date(),
  )
}

/** Local-time end of the event. */
export function eventEnd(event: Pick<CollegeEvent, 'date' | 'endTime' | 'startTime'>): Date {
  return parse(`${event.date} ${event.endTime || event.startTime || '00:00'}`, DATE_TIME_FORMAT, new Date())
}

export interface ResolvedStatus {
  status: EventStatus
  /** Finished, but still inside the grace window with no report uploaded. */
  pendingReport: boolean
  /** Cancelled by the lifecycle rule rather than by the teacher. */
  autoCancelled: boolean
  reason: CancelReason | null
}

const UNRESOLVED: ResolvedStatus = {
  status: 'upcoming',
  pendingReport: false,
  autoCancelled: false,
  reason: null,
}

/** Everything the lifecycle rule depends on — a full event, or just this slice of one. */
export type StatusInput = Pick<
  CollegeEvent,
  'date' | 'startTime' | 'endTime' | 'report' | 'status'
> &
  Partial<Pick<CollegeEvent, 'cancelledReason'>>

/**
 * Derives an event's status from its own date and times:
 *
 *   before start        → upcoming
 *   start … end         → ongoing
 *   ended, within 7d   → completed (report still pending if none uploaded)
 *   ended, past 7d     → completed if a report exists, else cancelled (no_report)
 *
 * A cancellation the teacher made by hand is sticky and never auto-overwritten.
 * The UI renders this rather than the stored `status` field, so labels stay
 * truthful even when the stored value lags.
 *
 * Events cancelled before this rule existed carry no `cancelledReason`. They
 * were all cancelled by hand — automatic cancellation was only introduced
 * along with the reason field — so a missing reason is read as manual. That
 * keeps a deliberately cancelled future event from silently becoming
 * "upcoming" again, and `planStatusSync` backfills the reason on first visit.
 *
 * The `!report` guard matters because uploading a report clears the reason on
 * its way to completing the event. Without it, a report landing on an
 * auto-cancelled event would clear the reason and then be read back as a manual
 * cancellation, so the event could never be completed.
 */
export function resolveStatus(
  event: StatusInput,
  now: Date = new Date(),
): ResolvedStatus {
  if (event.status === 'cancelled' && event.cancelledReason !== 'no_report' && !event.report) {
    return { status: 'cancelled', pendingReport: false, autoCancelled: false, reason: 'manual' }
  }

  const start = eventStart(event)
  const end = eventEnd(event)
  if (!isValid(start) || !isValid(end)) {
    return { ...UNRESOLVED, status: event.status }
  }

  const nowMs = now.getTime()
  if (nowMs < start.getTime()) {
    return { ...UNRESOLVED, status: 'upcoming' }
  }
  if (nowMs < end.getTime()) {
    return { ...UNRESOLVED, status: 'ongoing' }
  }

  const graceEnd = addDays(end, REPORT_GRACE_DAYS)
  const pendingReport = !event.report

  if (nowMs < graceEnd.getTime()) {
    return { ...UNRESOLVED, status: 'completed', pendingReport }
  }
  if (!pendingReport) {
    return { ...UNRESOLVED, status: 'completed' }
  }
  return {
    status: 'cancelled',
    pendingReport: false,
    autoCancelled: true,
    reason: 'no_report',
  }
}

export interface StatusPatch {
  id: string
  status: EventStatus
  cancelledReason: CancelReason | null
  cancelledAt: Date | null
}

/**
 * Works out which of the signed-in teacher's own events need their stored
 * status brought in line with the lifecycle rule. Returns an empty list when
 * everything already agrees, so re-running is free.
 */
export function planStatusSync(
  events: CollegeEvent[],
  uid: string | null | undefined,
  now: Date = new Date(),
): StatusPatch[] {
  if (!uid) return []

  const patches: StatusPatch[] = []
  for (const event of events) {
    if (event.coordinatorId !== uid) continue

    const resolved = resolveStatus(event, now)
    const storedReason = event.cancelledReason ?? null
    if (resolved.status === event.status && resolved.reason === storedReason) continue

    patches.push({
      id: event.id,
      status: resolved.status,
      cancelledReason: resolved.reason,
      cancelledAt: resolved.autoCancelled ? (event.cancelledAt ?? now) : null,
    })
  }
  return patches
}
