import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, LayoutGrid, ListFilter, PlusCircle, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useEvents, type ListedEvent } from '../hooks/useEvents'
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

/** The next thing due first. The tie-break keeps same-day events in a stable order. */
const byDate = (a: ListedEvent, b: ListedEvent) =>
  a.event.date.localeCompare(b.event.date) || a.event.id.localeCompare(b.event.id)

/**
 * Newest filed first — `created_at`, not the event's date.
 *
 * Sorting a "what is new" list by the event's own date is the mistake this
 * exists to avoid: it answers "when does this happen", which is what the other
 * group is for, and a long-future event filed yesterday is exactly the one a
 * reader is looking for.
 */
const byRecentlyAdded = (a: ListedEvent, b: ListedEvent) =>
  b.event.createdAt.getTime() - a.event.createdAt.getTime() || a.event.id.localeCompare(b.event.id)

export default function Events() {
  const { profile, loading: profileLoading } = useAuth()
  const { items, loading } = useEvents()
  const { departments } = useDepartments()
  const [searchParams, setSearchParams] = useSearchParams()

  const status = (searchParams.get('status') as EventStatus | null) ?? 'all'
  const departmentId = searchParams.get('department') ?? 'all'
  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'list'
  const [search, setSearch] = useState('')

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  // null rather than undefined: no department means this account cannot be in
  // one, and "not loaded yet" is not the same answer. See the note below.
  const myDepartmentId = profile?.departmentId ?? null

  const matching = useMemo(() => {
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
  }, [items, status, departmentId, search])

  /**
   * Two groups, the viewer's own department first.
   *
   * A teacher's department is the set of events they can actually edit, cancel
   * or delete — the ones they come to this page to act on — so those lead.
   * Everything else is ordered by when it was filed, which answers a different
   * question ("what is new in the college") that date order cannot: an event
   * filed last week for a date next term would otherwise sit below everything
   * that is happening sooner.
   *
   * The two groups are ordered differently on purpose. The first is an events
   * list, so it stays in date order and the next thing due is next. The second
   * is a "what is new" tail, so it stays in the order things arrived.
   *
   * This is a partition by *department*, not by filer. Which teacher created an
   * event is a fact about the archive rather than a filter over it, so there is
   * still no per-person view — see the `isMine` assertions in verify-lifecycle.
   */
  const { mine, others } = useMemo(() => {
    if (!myDepartmentId) {
      // No department to claim anything, so everything is "elsewhere" and sorts
      // by when it was filed. An account with no profile still sees the archive.
      return { mine: [] as ListedEvent[], others: [...matching].sort(byRecentlyAdded) }
    }
    return {
      mine: matching.filter((i) => i.event.departmentId === myDepartmentId).sort(byDate),
      others: matching
        .filter((i) => i.event.departmentId !== myDepartmentId)
        .sort(byRecentlyAdded),
    }
  }, [matching, myDepartmentId])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete(key)
    else next.set(key, value)
    setSearchParams(next)
  }

  // The partition is only knowable once the profile lands, and it arrives on its
  // own subscription, separately from the events. Rendering before then would
  // put every event in the "elsewhere" group and then shuffle the page under the
  // reader once the department arrived. Waiting costs a skeleton for a moment and
  // saves a list that reorders itself in front of you.
  const busy = loading || profileLoading

  const groups = [
    { title: deptMap.get(myDepartmentId ?? '')?.name ?? 'Your department', items: mine },
    { title: 'Recently added elsewhere', items: others },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        {/* Full-width controls below sm. Wrapping fixed-width ones left a ragged
            right edge — a 176px search beside a variable-width select, then the
            view toggle and New Event stranded on a third line. */}
        <div className="flex flex-col gap-2 sm:flex-wrap sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-44">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              // text-base below sm so iOS does not zoom the page on focus.
              className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
            />
          </div>
          <div className="relative w-full sm:w-auto">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <select
              value={departmentId}
              onChange={(e) => setParam('department', e.target.value)}
              aria-label="Filter by department"
              className="w-full appearance-none rounded-lg border border-gray-300 px-2 py-2.5 pl-9 pr-8 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:w-auto sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
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
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2.5 text-sm font-medium transition sm:flex-none sm:pointer-fine:py-1.5 ${
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
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 sm:pointer-fine:py-2"
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
            aria-pressed={status === tab.value}
            className={`rounded-full px-3 py-2.5 text-sm font-medium transition sm:pointer-fine:py-1.5 ${
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
        busy ? (
          <div className="h-96 animate-pulse rounded-xl bg-gray-200" />
        ) : (
          // The calendar lays events out by the month they fall in, so there is
          // nothing to partition — the two groups would just re-interleave.
          <EventCalendar items={[...mine, ...others]} />
        )
      ) : busy ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
          No events match your filters.
        </div>
      ) : (
        /* A heading per group, so the order says something. A single flat grid
           sorted by two different keys just looks like a mistake. A group with
           nothing in it is dropped rather than shown as an empty heading. */
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.title} className="space-y-3">
              <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                {group.title}
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-600">
                  {group.items.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <EventCard
                    key={item.event.id}
                    event={item.event}
                    department={deptMap.get(item.event.departmentId)}
                    status={item.status}
                    cancelledReason={item.cancelledReason}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}