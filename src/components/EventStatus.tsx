import { Ban } from 'lucide-react'
import type { CancelReason, EventStatus } from '../types'
import { STATUS_LABELS } from '../types'

/*
 * Status colours are semantic tokens from the theme, not ad-hoc palette
 * classes, so the five derived statuses agree with the banners elsewhere:
 * info = not started, success = live, warning = waiting on a report,
 * brand = closed off, danger = cancelled.
 */
const STYLES: Record<EventStatus, string> = {
  upcoming: 'bg-info-50 text-info-700 ring-info-600/20',
  ongoing: 'bg-success-50 text-success-700 ring-success-600/20',
  awaiting_report: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  completed: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  cancelled: 'bg-danger-50 text-danger-700 ring-danger-600/20',
}

export const DOT: Record<EventStatus, string> = {
  upcoming: 'bg-info-500',
  ongoing: 'bg-success-500',
  awaiting_report: 'bg-warning-500',
  completed: 'bg-brand-500',
  cancelled: 'bg-danger-500',
}

interface EventStatusProps {
  status: EventStatus
  /** Why it was cancelled, so an automatic one is not mistaken for a deliberate one. */
  cancelledReason?: CancelReason | null
}

export default function EventStatus({
  status,
  cancelledReason = null,
}: EventStatusProps) {
  const label = STATUS_LABELS[status]

  if (status === 'cancelled' && cancelledReason === 'no_report') {
    return (
      <span
        title="Cancelled — no report submitted."
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES.cancelled}`}
      >
        <Ban className="h-3 w-3" />
        No report
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {label}
    </span>
  )
}
