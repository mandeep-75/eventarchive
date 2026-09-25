import { useEffect, useState } from 'react'

/**
 * A clock that re-renders on an interval, so time-derived state (event status,
 * grace windows) stays truthful without needing a database write to nudge it.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
