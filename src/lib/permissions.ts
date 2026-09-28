import type { CollegeEvent } from '../types'

/**
 * Editing an event is a department permission, not a personal one: any teacher
 * in the department that owns the event may change or delete it. This is the
 * single source of truth for that rule — `EventDetails`, `EditEvent` and the
 * report upload all call it, so the checks cannot drift apart.
 *
 * The database enforces the same thing in the events_update and events_delete
 * policies, keyed on `my_department()`. This copy is only so the interface can
 * hide buttons that would fail; it is not the security boundary.
 *
 * The teacher who created an event is still recorded on it, and shown as
 * "Created by …" on the card and the details page, but that is display only and
 * grants nothing. Removing the per-teacher "My Events" view is the same decision:
 * who filed an event is a fact about the archive, not a filter over it.
 */
export function canManageEvent(
  event: Pick<CollegeEvent, 'departmentId'>,
  departmentId: string | null | undefined,
): boolean {
  return !!departmentId && event.departmentId === departmentId
}
