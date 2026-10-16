import { Link } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, UserCheck } from 'lucide-react'
import type { CancelReason, CollegeEvent, Department, EventStatus as EventStatusValue } from '../types'
import EventStatus from './EventStatus'
import NoImage from './NoImage'
import { useSignedUrl } from '../supabase/storage'
import { useAuth } from '../context/AuthContext'
import { formatTime } from '../lib/eventStatus'

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
  const { isManager } = useAuth()
  // The bucket's read policy is managers-only, so a signature for anyone else
  // is refused before it exists. Not attempting it is the difference between a
  // placeholder and a card that fires a request it knows will be denied.
  // isManager is false until the profile lands, so a manager sees the photo a
  // moment after the card itself — the alternative is signing for everyone and
  // letting the policy sort them out, which is the request this avoids.
  const coverUrl = useSignedUrl(isManager ? event.coverImage : null)
  const date = new Date(event.date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <Link
      to={`/events/${event.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card transition duration-200 ease-out-soft hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
    >
      {/* Always this height, cover or not: a grid of cards that alternates
          between with-a-photo and without reads as broken, and it made every
          card below sit at a different height. */}
      <div className="h-36 w-full overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={event.title}
            className="h-full w-full object-cover transition duration-500 ease-out-soft group-hover:scale-[1.04]"
          />
        ) : (
          // A set cover is unreadable to anyone but a manager, so it is not
          // "missing" for them — the placeholder has to say so. A manager whose
          // signature is simply still in flight should not be told the photo is
          // hidden from them, so the copy is only for non-managers.
          <NoImage
            className="h-full w-full"
            label={
              event.coverImage && !isManager ? 'Cover visible to managers only' : 'No cover image'
            }
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">
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
        <h3 className="font-semibold tracking-tight break-words text-gray-900">
          {event.title}
        </h3>
        {/* shrink-0 on every icon so a long venue takes the width instead of
            squashing the glyph beside it. */}
        <div className="mt-auto space-y-1.5 text-sm text-gray-500">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            {dateLabel}
          </p>
          <p className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            {formatTime(event.startTime)} – {formatTime(event.endTime)}
          </p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span className="min-w-0 break-words">{event.venue}</span>
          </p>
          {/* Always shown, not only for events the viewer filed. The name is
              copied onto the event at creation, so it needs no lookup and works
              for a colleague in another department. */}
          <p className="flex items-start gap-1.5 border-t border-gray-100 pt-2 text-xs text-gray-500">
            <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /> Created by{' '}
            <span className="min-w-0 break-words">
              {event.coordinatorName ?? 'a teacher'}
            </span>
          </p>
        </div>
      </div>
    </Link>
  )
}
