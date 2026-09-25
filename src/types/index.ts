export type UserRole = 'teacher'

export type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled'

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
  status: EventStatus
  coverImage: string | null
  images: string[]
  /** Owning teacher (auth user id). The owner alone may edit, cancel or delete this event. */
  coordinatorId: string
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
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  manual: 'Cancelled by department',
  no_report: 'Cancelled — report not submitted',
}
