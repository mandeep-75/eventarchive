import type { CollegeEvent, Department, UserProfile } from '../types'

/**
 * Postgres columns are snake_case; the app has always used camelCase, so every
 * row crosses this boundary here. Row types are deliberately loose (`any`)
 * because the JSON comes back untyped — the mappers are the type check.
 */

type Row = Record<string, any>

const iso = (v: unknown): Date | undefined => (v ? new Date(v as string) : undefined)
const isoOrNull = (v: unknown): Date | null => (v ? new Date(v as string) : null)

export function toProfile(row: Row): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: 'teacher',
    departmentId: row.department_id ?? null,
    isManager: row.is_manager ?? false,
    createdAt: iso(row.created_at),
  }
}

export function fromProfile(patch: Partial<UserProfile>): Row {
  const out: Row = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.email !== undefined) out.email = patch.email
  if (patch.departmentId !== undefined) out.department_id = patch.departmentId
  if (patch.isManager !== undefined) out.is_manager = patch.isManager
  return out
}

export function toDepartment(row: Row): Department {
  return {
    id: row.id,
    name: row.name,
    createdAt: iso(row.created_at),
  }
}

export function fromDepartment(patch: Partial<Department>): Row {
  const out: Row = {}
  if (patch.name !== undefined) out.name = patch.name
  return out
}

export function toEvent(row: Row): CollegeEvent {
  return {
    id: row.id,
    title: row.title,
    departmentId: row.department_id,
    date: row.event_date,
    startTime: row.start_time,
    endTime: row.end_time,
    venue: row.venue,
    description: row.description ?? '',
    status: row.status,
    coverImage: row.cover_image ?? null,
    images: row.images ?? [],
    coordinatorId: row.coordinator_id,
    cancelledReason: row.cancelled_reason ?? null,
    cancelledAt: isoOrNull(row.cancelled_at),
    guestSpeaker: row.guest_speaker ?? null,
    participantCount: row.participant_count ?? null,
    report: row.report ?? null,
    reportName: row.report_name ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

export function fromEvent(patch: Partial<CollegeEvent>): Row {
  const out: Row = {}
  const put = (column: string, key: keyof CollegeEvent) => {
    if (patch[key] !== undefined) out[column] = patch[key]
  }

  put('title', 'title')
  put('department_id', 'departmentId')
  put('event_date', 'date')
  put('start_time', 'startTime')
  put('end_time', 'endTime')
  put('venue', 'venue')
  put('description', 'description')
  put('status', 'status')
  put('cover_image', 'coverImage')
  put('images', 'images')
  put('cancelled_reason', 'cancelledReason')
  put('cancelled_at', 'cancelledAt')
  put('guest_speaker', 'guestSpeaker')
  put('participant_count', 'participantCount')
  put('report', 'report')
  put('report_name', 'reportName')
  return out
}

/**
 * Columns the app inserts a new event with.
 *
 * `id` is generated on the client with crypto.randomUUID() because the cover
 * image is uploaded before the row exists, and the upload path needs the id it
 * will later be filed under. The database default is only a fallback.
 */
export function eventInsertRow(
  data: Omit<CollegeEvent, 'createdAt' | 'updatedAt'>,
): Row {
  return {
    ...fromEvent(data),
    id: data.id,
    coordinator_id: data.coordinatorId,
  }
}
