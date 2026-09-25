import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Clock,
  ExternalLink,
  FileText,
  ImagePlus,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { getEvent, deleteEvent, updateEvent } from '../supabase/data'
import {
  uploadEventImage,
  uploadReport,
  useSignedUrl,
  useSignedUrls,
} from '../supabase/storage'
import { useDepartments } from '../hooks/useDepartments'
import { useNow } from '../hooks/useNow'
import { useAuth } from '../context/AuthContext'
import EventStatus from '../components/EventStatus'
import { isEventOwner } from '../lib/ownership'
import { eventEnd, resolveStatus } from '../lib/eventStatus'
import { CANCEL_REASON_LABELS, type CollegeEvent } from '../types'

// External tool the department uses to draft the write-up before it is
// uploaded here as the event's report.
const REPORT_MAKER_URL = 'https://report-maker-rho.vercel.app/'

export default function EventDetails() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [event, setEvent] = useState<CollegeEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)
  const reportInputRef = useRef<HTMLInputElement>(null)
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    getEvent(id).then((e) => {
      setEvent(e)
      setLoading(false)
    })
  }, [id])

  const now = useNow()
  const resolved = event ? resolveStatus(event, now) : null

  // Media is stored as a private-bucket path, so each render site signs it
  // first rather than the database holding a temporary URL. These sit above
  // the early returns below, which would otherwise run hooks conditionally.
  const coverUrl = useSignedUrl(event?.coverImage)
  const galleryUrls = useSignedUrls(event?.images ?? [])
  const reportUrl = useSignedUrl(event?.report)
  // Only paths that actually signed get an <img>; a failed signature would
  // otherwise render a broken image box.
  const signedGallery = Object.entries(galleryUrls)

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
  }

  if (!event || !resolved) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
        Event not found.
      </div>
    )
  }

  const current = event
  const department = getDepartment(current.departmentId)
  const isOwner = isEventOwner(current, user?.id)
  const isManuallyCancelled = current.cancelledReason === 'manual'
  // Once the end time has passed the only question left is whether a report
  // closes the event off or it gets called off, so those two actions get their
  // own panel instead of sitting in different corners of the page.
  const hasEnded = eventEnd(current).getTime() <= now.getTime()
  // Once an event is over with nothing filed, uploading the report is the one
  // thing left to do, so it gets the filled button rather than an outline.
  const needsReport = hasEnded && !current.report

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
    await deleteEvent(current.id)
    navigate('/events')
  }

  async function handleCancel() {
    if (
      !confirm(
        `Cancel "${current.title}"? It will be marked cancelled and will not update itself again.`,
      )
    )
      return
    await patch({ status: 'cancelled', cancelledReason: 'manual', cancelledAt: new Date() })
    setNotice('Event cancelled.')
  }

  async function handleRestore() {
    await patch({ status: 'upcoming', cancelledReason: null, cancelledAt: null })
    setNotice('Cancellation removed. The status is derived from the date again.')
  }

  async function handleAddImages(files: FileList | null) {
    if (!id || !files || files.length === 0) return
    setUploading(true)
    try {
      const urls: string[] = []
      for (const file of Array.from(files)) {
        urls.push(await uploadEventImage(id, file, Date.now()))
      }
      await patch({ images: [...current.images, ...urls] })
    } finally {
      setUploading(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  async function handleUploadReport(file: File | null) {
    if (!id || !file) return
    setUploading(true)
    try {
      const url = await uploadReport(id, file)
      // A report means the event is no longer report-less, so a cancellation
      // that the lifecycle rule applied is cleared as soon as it lands. The
      // status moves to completed too, otherwise the cleared reason would leave
      // a stale 'cancelled' behind for the next reader to interpret.
      const clearsAutoCancel =
        current.cancelledReason === 'no_report' || current.status === 'cancelled'
      await patch({
        report: url,
        reportName: file.name,
        ...(clearsAutoCancel
          ? { status: 'completed' as const, cancelledReason: null, cancelledAt: null }
          : {}),
      })
      setNotice('Report uploaded.')
    } finally {
      setUploading(false)
      if (reportInputRef.current) reportInputRef.current.value = ''
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <Link
        to="/events"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {notice && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{notice}</p>
      )}

      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {coverUrl && (
          <div className="h-48 w-full bg-gray-100 sm:h-64">
            <img
              src={coverUrl}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <header className="space-y-3 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                {department?.name ?? 'Unknown department'}
              </p>
              <h1 className="mt-1 break-words text-2xl font-bold leading-tight text-gray-900 sm:text-3xl">
                {current.title}
              </h1>
            </div>
            <EventStatus
              status={resolved.status}
              pendingReport={resolved.pendingReport}
              cancelledReason={resolved.reason ?? current.cancelledReason ?? null}
            />
          </div>

          {current.description && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-600">
              {current.description}
            </p>
          )}
        </header>

        {(resolved.status === 'cancelled' || resolved.pendingReport) && (
          <div className="px-6 pb-6">
            {resolved.status === 'cancelled' && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {CANCEL_REASON_LABELS[resolved.reason ?? current.cancelledReason ?? 'manual']}
              </p>
            )}

            {resolved.pendingReport && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                This event has finished and no report has been submitted. Upload a report
                within 7 days, otherwise it will be cancelled automatically.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 border-t border-gray-100 p-6 sm:grid-cols-2 lg:grid-cols-3">
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
          {current.participantCount != null && (
            <Info
              icon={<Users className="h-4 w-4" />}
              label="Participants"
              value={String(current.participantCount)}
            />
          )}
        </div>

        {/* Informational only. Every action lives in the single action bar at the
            bottom, so nothing here competes with or duplicates it. */}
        {isOwner && hasEnded && (
          <div className="mx-6 mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
            <h2 className="text-sm font-semibold text-gray-900">This event has finished</h2>
            <p className="mt-1 text-sm text-gray-600">
              {isManuallyCancelled
                ? 'You cancelled this event. Undo the cancellation if it did go ahead, then upload the report.'
                : 'Draft the write-up in the report maker, then upload it here to close this event off.'}
            </p>
          </div>
        )}

        {signedGallery.length > 0 && (
          <div className="border-t border-gray-100 p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Gallery</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {signedGallery.map(([path, src], i) => (
                <a key={path} href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={`${current.title} ${i + 1}`}
                    className="aspect-square w-full rounded-lg object-cover transition hover:opacity-90"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {current.report && reportUrl && (
          <div className="border-t border-gray-100 p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Report</h2>
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <FileText className="h-4 w-4" />
              {current.reportName ?? 'Download report'}
            </a>
          </div>
        )}

        {isOwner ? (
          <div className="space-y-4 border-t border-gray-100 p-6">
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/events/${current.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
              >
                <Pencil className="h-4 w-4" /> Edit
              </Link>

              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" /> Add photos
              </button>

              <button
                onClick={() => reportInputRef.current?.click()}
                disabled={uploading}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                  needsReport
                    ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50'
                }`}
              >
                <Upload className="h-4 w-4" />
                {current.report ? 'Replace report' : 'Upload report'}
              </button>

              <a
                href={REPORT_MAKER_URL}
                target="_blank"
                rel="noreferrer"
                title="Draft the event write-up in a new tab, then upload it here"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <ExternalLink className="h-4 w-4" /> Report maker
              </a>

              {uploading && <span className="self-center text-sm text-gray-400">Uploading…</span>}
            </div>

            {/* Destructive and state-changing controls, visually set apart from
                the everyday actions above so they are not hit by accident. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-4">
              {isManuallyCancelled ? (
                <button
                  onClick={handleRestore}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-indigo-600"
                >
                  <RotateCcw className="h-4 w-4" /> Undo cancel
                </button>
              ) : (
                <button
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-amber-600"
                >
                  <Ban className="h-4 w-4" /> Cancel event
                </button>
              )}

              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" /> Delete event
              </button>

              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-400">
                <UserCheck className="h-3.5 w-3.5" /> You created this
              </span>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 border-t border-gray-100 p-6 text-xs text-gray-400">
            <UserCheck className="h-3.5 w-3.5" /> You can view this event, but only its creator
            can edit it.
          </p>
        )}
      </article>

      {/* Kept outside the article so both triggers always have them. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleAddImages(e.target.files)}
        className="hidden"
      />
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

/** "21:57:00" -> "9:57 PM". Falls back to the stored value if it is unparseable. */
function formatTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return value
  const hour = Number(match[1])
  if (hour > 23) return value
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
      <span className="mt-0.5 text-indigo-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="break-words text-sm font-medium text-gray-800">{value}</p>
      </div>
    </div>
  )
}
