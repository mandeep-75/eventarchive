import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, LayoutGrid, ListFilter, PlusCircle, Search } from 'lucide-react'
import { useEvents } from '../hooks/useEvents'
import { useDepartments } from '../hooks/useDepartments'
import EventCard from '../components/EventCard'
import EventCalendar from '../components/EventCalendar'
import type { EventStatus } from '../types'

const STATUS_TABS: Array<{ value: EventStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'awaiting_report', label: 'Awaiting report' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function Events() {
  const { items, loading } = useEvents()
  const { departments } = useDepartments()
  const [searchParams, setSearchParams] = useSearchParams()

  const status = (searchParams.get('status') as EventStatus | null) ?? 'all'
  const departmentId = searchParams.get('department') ?? 'all'
  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'list'
  const [search, setSearch] = useState('')

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  const filtered = useMemo(() => {
    return items
      .filter((i) => (status === 'all' ? true : i.status === status))
      .filter((i) =>
        departmentId === 'all' ? true : i.event.departmentId === departmentId,
      )
      .filter((i) =>
        search
          ? i.event.title.toLowerCase().includes(search.toLowerCase()) ||
            i.event.venue.toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => a.event.date.localeCompare(b.event.date))
  }, [items, status, departmentId, search])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    setSearchParams(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              className="w-44 rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="relative">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <select
              value={departmentId}
              onChange={(e) => setParam('department', e.target.value)}
              aria-label="Filter by department"
              className="appearance-none rounded-lg border border-gray-300 px-2 py-2 pl-9 pr-8 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          {/* List and calendar are two views of the same filtered set. */}
          <div className="flex rounded-lg border border-gray-300 p-0.5">
            {(
              [
                { value: 'list', label: 'List', icon: LayoutGrid },
                { value: 'calendar', label: 'Calendar', icon: CalendarDays },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setParam('view', option.value)}
                aria-pressed={view === option.value}
                title={`${option.label} view`}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
                  view === option.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <option.icon className="h-4 w-4" />
                {option.label}
              </button>
            ))}
          </div>
          <Link
            to="/events/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            <PlusCircle className="h-4 w-4" /> New Event
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setParam('status', tab.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              status === tab.value
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'calendar' ? (
        loading ? (
          <div className="h-96 animate-pulse rounded-xl bg-gray-200" />
        ) : (
          <EventCalendar items={filtered} />
        )
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
          No events match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ event, status: s, cancelledReason }) => (
            <EventCard
              key={event.id}
              event={event}
              department={deptMap.get(event.departmentId)}
              status={s}
              cancelledReason={cancelledReason}
            />
          ))}
        </div>
      )}
    </div>
  )
}