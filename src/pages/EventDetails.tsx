import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Handshake,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { clearEventReport, getEvent, deleteEvent, updateEvent } from '../supabase/data'
import { deleteFile, signDownloadUrl, uploadReport, useOnDemandSigner, useSignedUrl } from '../supabase/storage'
import { useDepartments } from '../hooks/useDepartments'
import { useNow } from '../hooks/useNow'
import { useAuth } from '../context/AuthContext'
import EventStatus from '../components/EventStatus'
import NoImage from '../components/NoImage'
import { canManageEvent } from '../lib/permissions'
import {
  REPORT_GRACE_DAYS,
  eventEnd,
  formatTime,
  resolveStatus,
} from '../lib/eventStatus'
import { checkReportFile } from '../lib/eventInput'
import { CANCEL_REASON_LABELS, type CollegeEvent } from '../types'

// External tool the department uses to draft the write-up before it is
// uploaded here as the event's report.
const REPORT_MAKER_URL = 'https://report-maker-rho.vercel.app/'

export default function EventDetails() {
  const { id } = useParams<{ id: string }>()
  const { profile, isManager } = useAuth()
  const [event, setEvent] = useState<CollegeEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deletingReport, setDeletingReport] = useState(false)
  // The report's own error slot, kept next to the buttons that raise it rather
  // than in the page banner above the card.
  const [reportError, setReportError] = useState('')
  const [notice, setNotice] = useState('')
  // Separate from `notice`, so a success does not have to be edited out before
  // a failure can be shown.
  const [error, setError] = useState('')
  // Reset while rendering rather than in the fetch effect: the effect runs
  // after the new URL has already been committed, so the previous event would
  // sit under the new id for a frame — and for as long as the new fetch takes.
  // The route reuses this component when only the id changes.
  const [prevId, setPrevId] = useState(id)
  if (prevId !== id) {
    setPrevId(id)
    setLoading(true)
    setEvent(null)
    setNotice('')
    setError('')
  }
  const reportInputRef = useRef<HTMLInputElement>(null)
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getEvent(id)
      .then((e) => {
        if (cancelled) return
        setEvent(e)
        setLoading(false)
      })
      .catch((err) => {
        // Without this the failure never turns loading off, and the page sits
        // on a skeleton for good with nothing to say why.
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load this event.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const now = useNow()
  const resolved = event ? resolveStatus(event, now) : null

  // Media is stored as a private-bucket path, so each render site signs it
  // first rather than the database holding a temporary URL. These sit above
  // the early returns below, which would otherwise run hooks conditionally.
  //
  // The cover is signed on arrival because the list shows it and a card without
  // a picture is not a card. The report is not: it is signed only when a manager
  // actually opens it, so nobody pulls a report off storage just by viewing an
  // event.
  //
  // isManager gates both because reading media is managers-only in schema.sql.
  // The path itself is on the row either way, but a non-manager is never sent a
  // request the storage policy would refuse.
  const coverUrl = useSignedUrl(isManager ? event?.coverImage : null)
  const media = useOnDemandSigner()

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
  }

  if (!event || !resolved) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <h1 className="text-lg font-bold text-gray-900">Event not found</h1>
          <p className="mt-2 text-sm text-gray-500">
            {error || 'It may have been deleted, or the link is wrong.'}
          </p>
        </div>
        <div className="text-center">
          <Link
            to="/events"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:pointer-fine:py-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back to events
          </Link>
        </div>
      </div>
    )
  }

  const current = event
  const department = getDepartment(current.departmentId)
  const canManage = canManageEvent(current, profile?.departmentId)
  const isManuallyCancelled = current.cancelledReason === 'manual'
  // Once the end time has passed the only question left is whether a report
  // closes the event off or it gets called off.
  const hasEnded = eventEnd(current).getTime() <= now.getTime()
  // Once an event is over with nothing filed, uploading the report is the one
  // thing left to do, so it gets the filled button rather than an outline. A
  // report that was filed and since deleted still counts: the event is done, and
  // a replacement upload is optional rather than the outstanding task.
  const needsReport = hasEnded && !current.report && !current.reportFiled

  const date = new Date(current.date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  async function patch(data: Partial<CollegeEvent>) {
    if (!id) return
    await updateEvent(id, data)
    setEvent((prev) => (prev ? { ...prev, ...data } : prev))
  }

  async function handleDelete() {
    if (!confirm(`Delete "${current.title}"? This cannot be undone.`)) return
    try {
      await deleteEvent(current.id)
      navigate('/events')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event.')
    }
  }

  async function handleCancel() {
    if (
      !confirm(
        `Cancel "${current.title}"? It will be marked cancelled and will not update itself again.`,
      )
    )
      return
    // Only the reason and the timestamp are stored. Cancelled is a thing a
    // person did, so it is recorded; upcoming/ongoing/completed are not, they
    // come from the clock.
    try {
      await patch({ cancelledReason: 'manual', cancelledAt: new Date() })
      setError('')
      setNotice('Event cancelled.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the event.')
    }
  }

  async function handleRestore() {
    try {
      await patch({ cancelledReason: null, cancelledAt: null })
      setError('')
      setNotice('Cancellation removed. The status is derived from the date again.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the event.')
    }
  }

  async function handleUploadReport(file: File | null) {
    if (!id || !file) return
    const allowed = checkReportFile(file)
    if (!allowed.ok) {
      setError(allowed.error)
      if (reportInputRef.current) reportInputRef.current.value = ''
      return
    }
    setError('')
    setUploading(true)
    try {
      const url = await uploadReport(id, file)
      // A report means the event actually happened, so any cancellation is
      // dropped: a hand-made one would otherwise keep the page reading
      // "cancelled" right next to a filed report, and a no_report one is worked
      // out from the missing report in the first place. `reportFiled` is set here
      // only in local state — a database trigger stamps the column from `report`,
      // and fromEvent omits it, so the client never sends it — but carrying it in
      // the patch keeps the status correct on this render, before the refetch.
      await patch({
        report: url,
        reportName: file.name,
        reportFiled: true,
        cancelledReason: null,
        cancelledAt: null,
      })
      setNotice('Report uploaded.')
    } catch (err) {
      // Without this the failure is an unhandled rejection: the spinner stops
      // and the page says nothing at all about why the upload did not happen.
      setError(err instanceof Error ? err.message : 'Could not upload the report.')
    } finally {
      setUploading(false)
      if (reportInputRef.current) reportInputRef.current.value = ''
    }
  }

  async function handleDownloadReport() {
    if (!current.report) return
    setReportError('')
    setDownloading(true)
    try {
      // Signed for download rather than display, so the browser saves the file
      // rather than rendering a PDF or an image in a tab.
      const url = await signDownloadUrl(current.report, current.reportName ?? 'report')
      if (!url) throw new Error('That file could not be downloaded.')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'That file could not be downloaded.')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDeleteReport() {
    if (!id || !current.report) return
    const name = current.reportName ?? 'the report'
    // Asked twice on purpose: this removes the file itself, not just the row's
    // pointer to it, and nothing in the app can bring it back.
    if (!confirm(`Delete "${name}" from this event?`)) return
    if (!confirm(`Delete the file "${name}" for good? This cannot be undone.`)) return
    setError('')
    setReportError('')
    setDeletingReport(true)
    try {
      // The file goes first. If it cannot be removed the row is left alone, so a
      // refusal never leaves the archive pointing at a report that is still
      // there; the pointer is cleared only once the bytes are gone. Clearing it
      // goes through the manager-only definer function rather than an edit,
      // because a manager may remove any department's report and must not gain
      // the run of the rest of the row to do it.
      //
      // Only the pointer is cleared. reportFiled stays true, so the event keeps
      // reading completed: the file going does not un-happen the event.
      await deleteFile(current.report)
      await clearEventReport(current.id)
      setEvent((prev) => (prev ? { ...prev, report: null, reportName: null } : prev))
      setNotice('Report deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the report.')
    } finally {
      setDeletingReport(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      {/* -my-1.5 buys the 40px touch target without pushing the article down. */}
      <Link
        to="/events"
        className="-my-1.5 inline-flex items-center gap-1.5 py-3 text-sm text-gray-500 transition hover:text-gray-700 sm:pointer-fine:my-0 sm:pointer-fine:py-0"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {notice && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{notice}</p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="h-44 w-full sm:h-64">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          ) : (
            // The bucket is readable by managers only, so a set cover is not
            // "missing" for everyone else — it is simply not shown to them.
            <NoImage
              className="h-full w-full"
              label={
                current.coverImage ? 'Cover visible to managers only' : 'No cover image set'
              }
            />
          )}
        </div>

        <header className="space-y-3 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                {department?.name ?? 'Unknown department'}
              </p>
              <h1 className="mt-1 break-words text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">
                {current.title}
              </h1>
            </div>
            <EventStatus
              status={resolved.status}
              cancelledReason={resolved.reason ?? current.cancelledReason ?? null}
            />
          </div>

          {current.description && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-600">
              {current.description}
            </p>
          )}

          <p className="flex items-center gap-1.5 text-xs text-gray-400">
            <UserCheck className="h-3.5 w-3.5" /> Created by{' '}
            {current.coordinatorName ?? 'a teacher'}
          </p>
        </header>

        {(resolved.status === 'cancelled' || resolved.status === 'awaiting_report') && (
          <div className="px-4 pb-4 sm:px-6 sm:pb-6">
            {resolved.status === 'cancelled' && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {CANCEL_REASON_LABELS[resolved.reason ?? current.cancelledReason ?? 'manual']}
              </p>
            )}

            {resolved.status === 'awaiting_report' && (
              <p className="rounded-lg bg-warning-50 p-3 text-sm text-warning-700">
                {canManage
                  ? `Event over, no report yet. Upload one within ${REPORT_GRACE_DAYS} days or it is cancelled.`
                  : 'No report has been filed for this event yet.'}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
          <Info icon={<CalendarDays className="h-4 w-4" />} label="Date" value={dateLabel} />
          <Info
            icon={<Clock className="h-4 w-4" />}
            label="Time"
            value={`${formatTime(current.startTime)} – ${formatTime(current.endTime)}`}
          />
          <Info icon={<MapPin className="h-4 w-4" />} label="Venue" value={current.venue} />
          {current.guestSpeaker && (
            <Info
              icon={<UserRound className="h-4 w-4" />}
              label="Guest / Speaker"
              value={current.guestSpeaker}
            />
          )}
          {current.collaboration && (
            <Info
              icon={<Handshake className="h-4 w-4" />}
              label="In Collaboration With"
              value={current.collaboration}
            />
          )}
          {current.participantCount != null && (
            <Info
              icon={<Users className="h-4 w-4" />}
              label="Participants"
              value={String(current.participantCount)}
            />
          )}
        </div>

        {/* Reading the report is manager-only: the storage select policy is
            is_manager(), so the button that signs it sits behind isManager and
            nothing is signed on load. Filing it is the other half — the upload
            button lives under canManage below, because the insert policy only
            asks for the owning department. Deleting is a manager's job in any
            department, so it is not gated on canManage; the file's policy is
            is_manager() and the row's pointer is cleared by a manager-only
            definer function rather than an edit. Nothing here hints at whether
            a report exists for anyone who cannot read it. */}
        {isManager && current.report && (
          <div className="border-t border-gray-100 p-4 sm:p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Report</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void media.sign(current.report as string).then((url) => {
                    if (url) window.open(url, '_blank', 'noopener,noreferrer')
                  })
                }}
                disabled={!!media.pending[current.report]}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 sm:pointer-fine:py-2"
              >
                <FileText className="h-4 w-4 shrink-0" />
                {media.pending[current.report] ? (
                  'Opening…'
                ) : (
                  <span className="max-w-full truncate">{current.reportName ?? 'Open report'}</span>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadReport}
                disabled={downloading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 sm:pointer-fine:py-2"
              >
                <Download className="h-4 w-4 shrink-0" />
                {downloading ? 'Preparing…' : 'Download'}
              </button>

              <button
                type="button"
                onClick={handleDeleteReport}
                disabled={deletingReport}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 sm:pointer-fine:py-2"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {deletingReport ? 'Deleting…' : 'Delete file'}
              </button>
            </div>
            {media.error && <p className="mt-2 text-sm text-red-600">{media.error}</p>}
            {reportError && <p className="mt-2 text-sm text-red-600">{reportError}</p>}
          </div>
        )}

        {canManage ? (
          <div className="space-y-4 border-t border-gray-100 p-4 sm:p-6">
            {/* py-2.5 below sm on every action: at py-2 these were 36px tall
                buttons being hit with a fingertip. */}
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/events/${current.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-sm font-semibold text-brand-600 transition hover:bg-brand-50"
              >
                <Pencil className="h-4 w-4" /> Edit
              </Link>

              <button
                onClick={() => reportInputRef.current?.click()}
                disabled={uploading}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                  needsReport
                    ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
                    : 'border-brand-200 bg-white text-brand-600 hover:bg-brand-50'
                }`}
              >
                <Upload className="h-4 w-4" />
                {current.report ? 'Replace report' : 'Upload report'}
              </button>

              <a
                href={REPORT_MAKER_URL}
                target="_blank"
                rel="noreferrer"
                title="Draft the write-up, then upload it"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                <ExternalLink className="h-4 w-4" /> Report maker
              </a>

              {uploading && <span className="self-center text-sm text-gray-400">Uploading…</span>}
            </div>

            {/* Destructive and state-changing controls, visually set apart from
                the everyday actions above so they are not hit by accident. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-3 sm:gap-y-2 sm:pt-4">
              {isManuallyCancelled ? (
                <button
                  onClick={handleRestore}
                  className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-gray-500 transition hover:text-brand-600 sm:py-0"
                >
                  <RotateCcw className="h-4 w-4" /> Undo cancel
                </button>
              ) : (
                <button
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-gray-500 transition hover:text-warning-600 sm:py-0"
                >
                  <Ban className="h-4 w-4" /> Cancel event
                </button>
              )}

              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 py-2.5 text-sm font-medium text-gray-500 transition hover:text-red-600 sm:py-0"
              >
                <Trash2 className="h-4 w-4" /> Delete event
              </button>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-1.5 border-t border-gray-100 p-4 text-xs text-gray-400 sm:items-center sm:p-6">
            <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" /> View only — editing is
            limited to {department?.name ?? 'your department'} teachers.
          </p>
        )}
      </article>

      {/* Kept outside the article so the trigger always has it. */}
      <input
        ref={reportInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,image/*"
        onChange={(e) => handleUploadReport(e.target.files?.[0] ?? null)}
        className="hidden"
      />

    </div>
  )
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
      <span className="mt-0.5 text-brand-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="break-words text-sm font-medium text-gray-800">{value}</p>
      </div>
    </div>
  )
}
