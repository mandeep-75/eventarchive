export type UserRole = 'teacher'

/** Worked out from the event's date and times, never stored. */
export type EventStatus =
  | 'upcoming'
  | 'ongoing'
  | 'awaiting_report'
  | 'completed'
  | 'cancelled'

export type CancelReason = 'manual' | 'no_report'

export interface UserProfile {
  id: string
  name: string
  email: string
  role: UserRole
  departmentId: string | null
  isManager?: boolean
  createdAt?: Date
}

export interface Department {
  id: string
  name: string
  createdAt?: Date
}

export interface CollegeEvent {
  id: string
  title: string
  departmentId: string
  date: string
  startTime: string
  endTime: string
  venue: string
  description: string
  /**
   * No status here on purpose. It is worked out from `date`, `startTime` and
   * `endTime` against the clock every time the event is shown, so there is no
   * stored value that can fall behind the date. See `resolveStatus`.
   */
  coverImage: string | null
  images: string[]
  /** Owning teacher (auth user id). The owner alone may edit, cancel or delete this event. */
  coordinatorId: string
  /** Display name of whoever filed it, copied in at creation. */
  coordinatorName: string | null
  /** 'manual' only when a teacher cancelled the event by hand — that is sticky. */
  cancelledReason?: CancelReason | null
  cancelledAt?: Date | null
  guestSpeaker?: string | null
  participantCount?: number | null
  report?: string | null
  reportName?: string | null
  createdAt: Date
  updatedAt: Date
}

export const STATUS_LABELS: Record<EventStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  awaiting_report: 'Awaiting report',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  manual: 'Cancelled by department',
  no_report: 'Cancelled — report not submitted',
}
