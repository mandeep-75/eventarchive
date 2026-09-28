import { useEffect, useMemo, useState } from 'react'
import { subscribeEvents } from '../supabase/data'
import { useAuth } from '../context/AuthContext'
import { useNow } from './useNow'
import { resolveStatus } from '../lib/eventStatus'
import { canManageEvent } from '../lib/permissions'
import type { CancelReason, CollegeEvent, EventStatus } from '../types'

/** An event paired with its worked-out status and whether the viewer may edit it. */
export interface ListedEvent {
  event: CollegeEvent
  status: EventStatus
  cancelledReason: CancelReason | null
  /** The viewer's department owns this one, so the viewer may edit it. */
  canManage: boolean
}

export function useEvents() {
  const { profile } = useAuth()
  const [events, setEvents] = useState<CollegeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const now = useNow()

  useEffect(() => {
    const unsub = subscribeEvents((data) => {
      setEvents(data)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // Statuses are worked out here so the list renders truthfully the moment a row
  // arrives. Nothing is written back: there is no stored status to keep in step
  // in the first place.
  const items = useMemo<ListedEvent[]>(
    () =>
      events.map((event) => {
        const resolved = resolveStatus(event, now)
        return {
          event,
          status: resolved.status,
          cancelledReason: resolved.reason,
          canManage: canManageEvent(event, profile?.departmentId),
        }
      }),
    [events, profile?.departmentId, now],
  )

  return { items, loading }
}
