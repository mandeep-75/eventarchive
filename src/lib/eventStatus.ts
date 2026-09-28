import { addDays, isValid, parse } from 'date-fns'
import type { CancelReason, CollegeEvent, EventStatus } from '../types'

/**
 * Days after an event ends during which a report can still be submitted, and
 * only within which the event is not cancelled for want of one.
 *
 * A single constant on purpose. It is the same number for everyone, and the
 * tests below pin the behaviour it produces rather than its value, so changing
 * it here is the whole adjustment.
 */
export const REPORT_GRACE_DAYS = 10

/**
 * The zone event times are written in, as a fixed offset.
 *
 * An event is a date plus a bare `HH:mm` with no zone anywhere in the row, so
 * something has to name the zone they belong to. Pinned here rather than taken
 * from the visitor's device so every reader gets the same answer — a laptop set
 * to UTC and a phone set to IST must not disagree about when a 10:00 event
 * starts. IST is a constant +05:30 with no daylight saving, so a fixed offset is
 * exact year-round and needs no lookup table.
 */
const EVENT_TIME_ZONE = '+05:30'

const DATE_TIME_FORMAT_ZONED = 'yyyy-MM-dd HH:mmXXX'

/**
 * A `time` column always comes back from Postgres as `HH:mm:ss`, whatever was
 * written to it. The format above has no seconds token, so an untrimmed value
 * leaves a `:00` sitting between the minutes and the offset, the `X` token never
 * matches, and the whole parse fails.
 *
 * That failure is worth spelling out, because it is invisible: an unparseable
 * date is not an error the UI shows, it is an event that reads as `upcoming`
 * forever. A six-day-old event with a report window still open looks exactly
 * like one that has not started yet. Normalising here is what keeps the format
 * string and the column type from disagreeing.
 */
export function normalizeClock(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? '00:00' : trimmed.slice(0, 5)
}

/** Local-time start of the event. */
export function eventStart(event: Pick<CollegeEvent, 'date' | 'startTime'>): Date {
  return parse(
    `${event.date} ${normalizeClock(event.startTime)}${EVENT_TIME_ZONE}`,
    DATE_TIME_FORMAT_ZONED,
    new Date(),
  )
}

/** Local-time end of the event. */
export function eventEnd(event: Pick<CollegeEvent, 'date' | 'endTime' | 'startTime'>): Date {
  return parse(
    `${event.date} ${normalizeClock(event.endTime || event.startTime)}${EVENT_TIME_ZONE}`,
    DATE_TIME_FORMAT_ZONED,
    new Date(),
  )
}

export interface ResolvedStatus {
  status: EventStatus
  /** Cancelled by the lifecycle rule rather than by the teacher. */
  autoCancelled: boolean
  reason: CancelReason | null
}

/** Fallback for an event whose date or times cannot be read. */
const DEFAULT: ResolvedStatus = {
  status: 'upcoming',
  autoCancelled: false,
  reason: null,
}

/** Everything the rule depends on — a full event, or just this slice of one. */
export type StatusInput = Pick<
  CollegeEvent,
  'date' | 'startTime' | 'endTime' | 'report'
> &
  Partial<Pick<CollegeEvent, 'cancelledReason'>>

/**
 * Works out an event's status from its own date and times:
 *
 *   before start              → upcoming
 *   start … end               → ongoing
 *   ended, report uploaded    → completed
 *   ended, no report, < 10d   → awaiting_report
 *   ended, no report, ≥ 10d   → cancelled (no_report)
 *
 * An event is only ever "completed" once a report has been uploaded for it.
 * Between the end of the event and the deadline it is `awaiting_report`, which
 * is a state of its own rather than a flavour of completed: calling an event
 * done before anyone has written up what happened is the thing this rule exists
 * to prevent, and a boolean bolted onto "completed" is exactly the kind of
 * two-sources-of-truth that let the old stored status drift.
 *
 * Nothing is stored and nothing is written back. The database holds the date and
 * the times; this compares them to the clock each time an event is shown. There
 * used to be a status column kept in step by a browser, which left every event
 * a teacher did not own stuck on 'upcoming' long after it finished — with no
 * stored status at all, that cannot happen.
 *
 * A cancellation the teacher made by hand is sticky, because `cancelledReason`
 * is a record of something a person did rather than something the clock implies.
 * The other reason, no_report, is the one thing here that is not stored, which
 * is why it is the only one that can appear in the result without being in the
 * row.
 *
 * The `!report` guard matters for the same reason: uploading a report clears the
 * reason on its way to completing an event, and without the guard that would
 * read back as a hand-made cancellation and the event could never be closed off.
 */
export function resolveStatus(
  event: StatusInput,
  now: Date = new Date(),
): ResolvedStatus {
  if (event.cancelledReason === 'manual' && !event.report) {
    return { status: 'cancelled', autoCancelled: false, reason: 'manual' }
  }

  const start = eventStart(event)
  const end = eventEnd(event)
  if (!isValid(start) || !isValid(end)) {
    // Falling back to `upcoming` reads as a fact about the event, and it is the
    // one status that makes a broken row look healthy. Say what is wrong instead:
    // this is data that never came back in a shape the parser can read, and it is
    // otherwise indistinguishable from a correctly-dated event that has not
    // started.
    console.error(
      `eventStatus: could not read the date for an event (date=${JSON.stringify(event.date)}, ` +
        `startTime=${JSON.stringify(event.startTime)}, endTime=${JSON.stringify(event.endTime)})`,
    )
    return { ...DEFAULT }
  }

  const nowMs = now.getTime()
  if (nowMs < start.getTime()) {
    return { ...DEFAULT, status: 'upcoming' }
  }
  if (nowMs < end.getTime()) {
    return { ...DEFAULT, status: 'ongoing' }
  }

  // Past the end, the report is the only thing that makes it completed.
  if (event.report) {
    return { ...DEFAULT, status: 'completed' }
  }

  if (nowMs < addDays(end, REPORT_GRACE_DAYS).getTime()) {
    return { ...DEFAULT, status: 'awaiting_report' }
  }

  return {
    status: 'cancelled',
    autoCancelled: true,
    reason: 'no_report',
  }
}
