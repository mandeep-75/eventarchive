import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Ban,
  CalendarDays,
  FileClock,
  MapPin,
  PlayCircle,
  PlusCircle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useEvents, type ListedEvent } from '../hooks/useEvents'
import { useDepartments } from '../hooks/useDepartments'
import { REPORT_GRACE_DAYS } from '../lib/eventStatus'
import EventCard from '../components/EventCard'
import EventStatus from '../components/EventStatus'

export default function Dashboard() {
  const { profile } = useAuth()
  const { items, loading } = useEvents()
  const { getDepartment } = useDepartments()

  const myDepartment = profile?.departmentId ? getDepartment(profile.departmentId) : undefined

  const counts = useMemo(
    () => ({
      ongoing: items.filter((i) => i.status === 'ongoing').length,
      upcoming: items.filter((i) => i.status === 'upcoming').length,
      completed: items.filter((i) => i.status === 'completed').length,
      awaitingReport: items.filter((i) => i.status === 'awaiting_report').length,
      noReport: items.filter((i) => i.cancelledReason === 'no_report').length,
    }),
    [items],
  )

  const ongoing = items.filter((i) => i.status === 'ongoing')
  // Newest filed first, across every department rather than filtered to the
  // viewer. This replaced a "My Events" panel, which was a second list of the same
  // department's events scoped to one person: on a department of any size it was
  // either a duplicate of the list below it or an empty box, and the person it
  // was about was the only thing on the page that was not about the archive.
  //
  // Sorted by `created_at`, not by the event's own date, because that is what the
  // heading claims. Sorting this by date showed the latest-*scheduled* events
  // instead — with a full calendar's worth of future events filed early, the
  // panel stopped moving at all. The Events page splits the same two orderings
  // apart, and this is the "what is new" half.
  const recent = useMemo(
    () =>
      [...items]
        .sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime())
        .slice(0, 6),
    [items],
  )
  const upcomingByDate = useMemo(() => {
    return items
      .filter((i) => i.status === 'upcoming')
      .sort((a, b) => a.event.date.localeCompare(b.event.date))
      .reduce<Record<string, ListedEvent[]>>((acc, i) => {
        ;(acc[i.event.date] ??= []).push(i)
        return acc
      }, {})
  }, [items])

  if (loading) return <DashboardSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {myDepartment?.name ?? 'Event'} Dashboard
          </h1>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            {' · you can see every department'}
          </p>
        </div>
        <Link
          to="/events/create"
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:pointer-fine:py-2"
        >
          <PlusCircle className="h-4 w-4" /> Create Event
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<PlayCircle className="h-5 w-5 text-green-600" />}
          label="Ongoing now"
          value={counts.ongoing}
          bg="bg-green-50"
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5 text-blue-600" />}
          label="Upcoming"
          value={counts.upcoming}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<FileClock className="h-5 w-5 text-amber-600" />}
          label="Awaiting report"
          value={counts.awaitingReport}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<Ban className="h-5 w-5 text-red-600" />}
          label="No report"
          value={counts.noReport}
          bg="bg-red-50"
        />
      </div>

      {(counts.awaitingReport > 0 || counts.noReport > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {counts.noReport > 0 && (
            <p>
              <span className="font-semibold">{counts.noReport}</span> event
              {counts.noReport === 1 ? '' : 's'} finished without a report and
              {counts.noReport === 1 ? ' was' : ' were'} cancelled automatically. The
              owner can still upload a report to restore {counts.noReport === 1 ? 'it' : 'them'}.
            </p>
          )}
          {counts.awaitingReport > 0 && (
            <p className={counts.noReport > 0 ? 'mt-1' : ''}>
              <span className="font-semibold">{counts.awaitingReport}</span> event
              {counts.awaitingReport === 1 ? '' : 's'} finished within the {REPORT_GRACE_DAYS} day
              grace period. Upload the report to keep {counts.awaitingReport === 1 ? 'it' : 'them'} from
              being cancelled.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <SectionHeader title="Ongoing" count={ongoing.length} to="/events?status=ongoing" />
          {ongoing.length === 0 ? (
            <EmptyState text="No events running right now" />
          ) : (
            <div className="space-y-2">
              {ongoing.map((item) => (
                <EventRow key={item.event.id} item={item} />
              ))}
            </div>
          )}

          <div className="pt-2">
            <SectionHeader title="Recently added" count={recent.length} to="/events" />
            {recent.length === 0 ? (
              <EmptyState text="No events yet" />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {recent.map((item) => (
                  <EventCard
                    key={item.event.id}
                    event={item.event}
                    department={getDepartment(item.event.departmentId)}
                    status={item.status}
                    cancelledReason={item.cancelledReason}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="space-y-3">
            <SectionHeader
              title="Upcoming"
              count={counts.upcoming}
              to="/events?status=upcoming"
            />
            {counts.upcoming === 0 ? (
              <EmptyState text="No upcoming events" />
            ) : (
              Object.entries(upcomingByDate).map(([date, dayItems]) => (
                <div
                  key={date}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <ul className="space-y-2">
                    {dayItems.map((item) => (
                      <li key={item.event.id}>
                        {/* py-2.5 for a 40px row: this is the only way to reach
                            an event from the Upcoming list on a phone. */}
                        <Link
                          to={`/events/${item.event.id}`}
                          className="flex items-center gap-2 rounded-lg px-2 py-2.5 text-sm transition hover:bg-gray-50 sm:pointer-fine:py-1.5"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                          <span className="truncate font-medium text-gray-800">
                            {item.event.title}
                          </span>
                          <span className="ml-auto shrink-0 text-xs text-gray-400">
                            {getDepartment(item.event.departmentId)?.name.split(' ')[0]}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function EventRow({ item }: { item: ListedEvent }) {
  const { event } = item
  return (
    <Link
      to={`/events/${event.id}`}
      className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
    >
      <div className="min-w-0">
        <h3 className="truncate font-semibold text-gray-900">{event.title}</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Created by {event.coordinatorName ?? 'a teacher'}
        </p>
        <p className="mt-1 flex items-center gap-3 text-sm text-gray-500">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {event.venue}
          </span>
          <span>{event.startTime}</span>
        </p>
      </div>
      <EventStatus
        status={item.status}
        cancelledReason={item.cancelledReason}
      />
    </Link>
  )
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode
  label: string
  value: number
  bg: string
}) {
  return (
    // Tighter below sm. In two columns on a 360px phone each card is ~156px
    // wide, and at p-4 with a 40px icon the label was left ~70px — enough to
    // read "Awaiting…" and nothing else.
    <div className={`flex items-center gap-2 rounded-xl ${bg} p-3 sm:gap-3 sm:p-4`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm sm:h-10 sm:w-10">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="truncate text-xs text-gray-500 sm:text-sm">{label}</p>
      </div>
    </div>
  )
}

function SectionHeader({ title, count, to }: { title: string; count: number; to: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="inline-flex items-center gap-2 font-semibold text-gray-900">
        {title}
        {count > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {count}
          </span>
        )}
      </h2>
      {/* -my-1.5 gives the link a 40px target on touch without adding 40px of
          air between the heading and the content below it. */}
      <Link
        to={to}
        className="-my-1.5 inline-flex items-center gap-1 py-3 text-xs font-medium text-indigo-600 hover:text-indigo-700 sm:pointer-fine:my-0 sm:pointer-fine:py-0"
      >
        View all <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
      {text}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
      {/* Two columns below lg, matching the real stat grid. Four across 328px
          gave each one 70px, which is a placeholder the shape of nothing. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
    </div>
  )
}
