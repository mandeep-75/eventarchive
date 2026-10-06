import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ListedEvent } from '../hooks/useEvents'
import { useDepartments } from '../hooks/useDepartments'
import EventStatus from './EventStatus'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Month grid for the Events page. Takes events that are already filtered by the
 * page above it, so both views respond to the same search and filters instead of
 * keeping a second set of controls in sync.
 */
export default function EventCalendar({ items }: { items: ListedEvent[] }) {
  const { departments } = useDepartments()
  const [current, setCurrent] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const year = current.getFullYear()
  const month = current.getMonth()
  const monthLabel = current.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ListedEvent[]>()
    for (const item of items) {
      const existing = map.get(item.event.date) ?? []
      existing.push(item)
      map.set(item.event.date, existing)
    }
    return map
  }, [items])

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) ?? [] : []
  const todayStr = toDateKey(new Date())

  function shiftMonth(delta: number) {
    setCurrent(new Date(year, month + delta, 1))
    setSelectedDate(null)
  }

  return (
    <div className="space-y-4">
      {/* p-2 below sm: every point of card gutter is a point of the 7 columns,
          and at p-4 a 360px phone had 42px per day. */}
      <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:p-4">
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="-ml-1.5 rounded-lg p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 sm:pointer-fine:p-1.5 sm:pointer-fine:ml-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="font-semibold text-gray-900">{monthLabel}</h2>
          <button
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="-mr-1.5 rounded-lg p-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 sm:pointer-fine:p-1.5 sm:pointer-fine:mr-0"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px text-center text-xs">
          {/* One letter below sm. Seven three-letter names need ~30px each and a
              360px phone has ~46px per column once the card gutter is taken,
              so they wrapped inside their own cells. */}
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2 font-semibold text-gray-400">
              <span className="sm:hidden" aria-hidden="true">
                {d[0]}
              </span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}

          {Array.from({ length: new Date(year, month, 1).getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="py-2 sm:py-4" />
          ))}

          {Array.from({ length: new Date(year, month + 1, 0).getDate() }).map((_, i) => {
            const day = i + 1
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayEvents = eventsByDate.get(dateStr) ?? []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                aria-label={`${dateStr}${dayEvents.length ? `, ${dayEvents.length} event(s)` : ''}`}
                aria-pressed={isSelected}
                className={`relative flex min-h-[3rem] flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 transition sm:min-h-[3.5rem] sm:py-2 ${
                  isSelected
                    ? 'bg-indigo-50 ring-2 ring-indigo-600'
                    : isToday
                      ? 'bg-gray-100'
                      : 'hover:bg-gray-50'
                }`}
              >
                <span
                  className={`text-sm font-medium ${
                    isToday
                      ? 'flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white'
                      : 'text-gray-800'
                  }`}
                >
                  {day}
                </span>
                {dayEvents.length > 0 && (
                  <span className="flex gap-0.5">
                    {dayEvents.slice(0, 3).map((item) => (
                      <span
                        key={item.event.id}
                        className={`h-1.5 w-1.5 rounded-full ${
                          item.status === 'ongoing'
                            ? 'bg-green-500'
                            : item.status === 'upcoming'
                              ? 'bg-blue-500'
                              : item.status === 'awaiting_report'
                                ? 'bg-amber-500'
                                : item.status === 'cancelled'
                                  ? 'bg-red-400'
                                  : 'bg-gray-300'
                        }`}
                      />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-900">
            {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h2>
          {selectedEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
              No events on this day.
            </div>
          ) : (
            selectedEvents.map((item) => (
              <Link
                key={item.event.id}
                to={`/events/${item.event.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-indigo-600">
                    {deptMap.get(item.event.departmentId)?.name ?? 'Unknown'}
                    {' · '}
                    {item.event.coordinatorName ?? 'a teacher'}
                  </p>
                  <h3 className="truncate font-semibold text-gray-900">{item.event.title}</h3>
                  <p className="text-sm text-gray-500">
                    {item.event.startTime} – {item.event.endTime} · {item.event.venue}
                  </p>
                </div>
                <EventStatus
                  status={item.status}
                  cancelledReason={item.cancelledReason}
                />
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}
