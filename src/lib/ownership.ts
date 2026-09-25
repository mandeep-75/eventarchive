import type { CollegeEvent } from '../types'

/**
 * A teacher may only change events they created. This is the single source of
 * truth for that rule — `EventDetails`, `EditEvent` and the report upload all
 * call it so the checks cannot drift apart.
 */
export function isEventOwner(
  event: Pick<CollegeEvent, 'coordinatorId'>,
  uid: string | null | undefined,
): boolean {
  return !!uid && event.coordinatorId === uid
}
