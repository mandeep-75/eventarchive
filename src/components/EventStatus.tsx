import { FileClock, Ban } from 'lucide-react'
import type { CancelReason, EventStatus } from '../types'
import { STATUS_LABELS } from '../types'

const STYLES: Record<EventStatus, string> = {
  upcoming: 'bg-blue-50 text-blue-700 ring-blue-200',
  ongoing: 'bg-green-50 text-green-700 ring-green-200',
  completed: 'bg-violet-50 text-violet-700 ring-violet-200',
  cancelled: 'bg-red-50 text-red-600 ring-red-200',
}

const DOT: Record<EventStatus, string> = {
  upcoming: 'bg-blue-500',
  ongoing: 'bg-green-500',
  completed: 'bg-violet-500',
  cancelled: 'bg-red-500',
}

interface EventStatusProps {
  status: EventStatus
  /** Finished, inside the grace window, no report uploaded yet. */
  pendingReport?: boolean
  /** Why it was cancelled, so an automatic one is not mistaken for a deliberate one. */
  cancelledReason?: CancelReason | null
}

export default function EventStatus({
  status,
  pendingReport = false,
  cancelledReason = null,
}: EventStatusProps) {
  const label = STATUS_LABELS[status]

  if (status === 'cancelled' && cancelledReason === 'no_report') {
    return (
      <span
        title="Finished without a submitted report, so it was cancelled automatically."
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES.cancelled}`}
      >
        <Ban className="h-3 w-3" />
        No report
      </span>
    )
  }

  if (pendingReport) {
    return (
      <span
        title="Finished. Upload a report before the grace period ends to avoid cancellation."
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES.completed}`}
      >
        <FileClock className="h-3 w-3" />
        {label} · report pending
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {label}
    </span>
  )
}
