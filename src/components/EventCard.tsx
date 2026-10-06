import { Link } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, UserCheck } from 'lucide-react'
import type { CancelReason, CollegeEvent, Department, EventStatus as EventStatusValue } from '../types'
import EventStatus from './EventStatus'
import NoImage from './NoImage'
import { useSignedUrl } from '../supabase/storage'

interface EventCardProps {
  event: CollegeEvent
  department?: Department
  /** Worked out from the event's date and times, so it is never a stored value. */
  status: EventStatusValue
  cancelledReason?: CancelReason | null
}

export default function EventCard({
  event,
  department,
  status,
  cancelledReason = null,
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
      {/* Always this height, cover or not: a grid of cards that alternates
          between with-a-photo and without reads as broken, and it made every
          card below sit at a different height. */}
      <div className="h-36 w-full overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={event.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <NoImage className="h-full w-full" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-indigo-600">
            {department?.name ?? 'Unknown'}
          </span>
          <EventStatus
            status={status}
            cancelledReason={cancelledReason}
          />
        </div>
        {/* break-words rather than truncate: a title is the one thing on a card
            that must stay readable, and a single long word would otherwise set
            the card's width and push the grid into a horizontal scroll. */}
        <h3 className="font-semibold break-words text-gray-900">{event.title}</h3>
        {/* shrink-0 on every icon so a long venue takes the width instead of
            squashing the glyph beside it. */}
        <div className="mt-auto space-y-1 text-sm text-gray-500">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            {dateLabel}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {event.startTime} – {event.endTime}
          </p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{event.venue}</span>
          </p>
          {/* Always shown, not only for events the viewer filed. The name is
              copied onto the event at creation, so it needs no lookup and works
              for a colleague in another department. */}
          <p className="flex items-start gap-1.5 pt-1 text-xs text-gray-400">
            <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Created by{' '}
            <span className="min-w-0 break-words">
              {event.coordinatorName ?? 'a teacher'}
            </span>
          </p>
        </div>
      </div>
    </Link>
  )
}
