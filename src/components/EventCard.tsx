import { Link } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, UserCheck } from 'lucide-react'
import type { CancelReason, CollegeEvent, Department, EventStatus as EventStatusValue } from '../types'
import EventStatus from './EventStatus'
import { useSignedUrl } from '../supabase/storage'

interface EventCardProps {
  event: CollegeEvent
  department?: Department
  status?: EventStatusValue
  pendingReport?: boolean
  cancelledReason?: CancelReason | null
  isMine?: boolean
}

export default function EventCard({
  event,
  department,
  status = event.status,
  pendingReport = false,
  cancelledReason = null,
  isMine = false,
}: EventCardProps) {
  // The bucket is private, so the stored path needs signing before it can go
  // in src. Renders nothing until the signature arrives.
  const coverUrl = useSignedUrl(event.coverImage)
  const date = new Date(event.date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <Link
      to={`/events/${event.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
    >
      {coverUrl && (
        <div className="h-36 w-full overflow-hidden bg-gray-100">
          <img
            src={coverUrl}
            alt={event.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-indigo-600">
            {department?.name ?? 'Unknown'}
          </span>
          <EventStatus
            status={status}
            pendingReport={pendingReport}
            cancelledReason={cancelledReason}
          />
        </div>
        <h3 className="font-semibold text-gray-900">{event.title}</h3>
        <div className="mt-auto space-y-1 text-sm text-gray-500">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {dateLabel}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {event.startTime} – {event.endTime}
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {event.venue}
          </p>
          {isMine && (
            <p className="flex items-center gap-1.5 pt-1 text-xs font-medium text-indigo-600">
              <UserCheck className="h-3.5 w-3.5" /> Created by you
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
