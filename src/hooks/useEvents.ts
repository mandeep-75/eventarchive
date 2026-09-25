import { useEffect, useMemo, useState } from 'react'
import { subscribeEvents, updateEvent } from '../supabase/data'
import { useAuth } from '../context/AuthContext'
import { useNow } from './useNow'
import { planStatusSync, resolveStatus } from '../lib/eventStatus'
import type { CancelReason, CollegeEvent, EventStatus } from '../types'

/** An event paired with its lifecycle-resolved status and the viewer's relation to it. */
export interface ListedEvent {
  event: CollegeEvent
  status: EventStatus
  /** Finished but still inside the grace window with no report uploaded. */
  pendingReport: boolean
  cancelledReason: CancelReason | null
  isMine: boolean
}

const syncInFlight = new Set<string>()

/**
 * Keeps the stored status of the signed-in teacher's own events in line with
 * the lifecycle rule. Only the owner's own events are ever written, and a
 * patch is only sent when the derived status actually disagrees, so this
 * settles after one pass instead of looping.
 */
function useEventStatusSync(
  events: CollegeEvent[],
  uid: string | null | undefined,
  now: Date,
) {
  useEffect(() => {
    if (!uid) return

    for (const patch of planStatusSync(events, uid, now)) {
      const key = `${patch.id}:${patch.status}:${patch.cancelledReason ?? ''}`
      if (syncInFlight.has(key)) continue
      syncInFlight.add(key)

      updateEvent(patch.id, {
        status: patch.status,
        cancelledReason: patch.cancelledReason,
        cancelledAt: patch.cancelledAt,
      })
        .catch(() => {
          // A failed sync only means the stored value lags; the UI already
          // renders the derived status, so there is nothing to recover from.
        })
        .finally(() => {
          syncInFlight.delete(key)
        })
    }
  }, [events, uid, now])
}

export function useEvents() {
  const { user } = useAuth()
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

  useEventStatusSync(events, user?.id, now)

  const items = useMemo<ListedEvent[]>(
    () =>
      events.map((event) => {
        const resolved = resolveStatus(event, now)
        return {
          event,
          status: resolved.status,
          pendingReport: resolved.pendingReport,
          cancelledReason: resolved.reason,
          isMine: event.coordinatorId === user?.id,
        }
      }),
    [events, user?.id, now],
  )

  return { items, loading }
}
