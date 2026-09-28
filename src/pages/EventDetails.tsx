import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Clock,
  ExternalLink,
  Eye,
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
  useOnDemandSigner,
  useSignedUrl,
} from '../supabase/storage'
import { useDepartments } from '../hooks/useDepartments'
import { useNow } from '../hooks/useNow'
import { useAuth } from '../context/AuthContext'
import EventStatus from '../components/EventStatus'
import NoImage from '../components/NoImage'
import { canManageEvent } from '../lib/permissions'
import { REPORT_GRACE_DAYS, eventEnd, resolveStatus } from '../lib/eventStatus'
import { checkImageFile, checkReportFile } from '../lib/eventInput'
import { CANCEL_REASON_LABELS, type CollegeEvent } from '../types'

// External tool the department uses to draft the write-up before it is
// uploaded here as the event's report.
const REPORT_MAKER_URL = 'https://report-maker-rho.vercel.app/'

export default function EventDetails() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const [event, setEvent] = useState<CollegeEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState('')
  // Separate from `notice`, so a success does not have to be edited out before
  // a failure can be shown.
  const [error, setError] = useState('')
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
  //
  // The cover is signed on arrival because the list shows it and a card without
  // a picture is not a card. The gallery and the report are not: they are signed
  // when a teacher actually opens one, so nobody pulls every photo and every
  // report off storage just by looking at an event.
  const coverUrl = useSignedUrl(event?.coverImage)
  const media = useOnDemandSigner()

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
  const canManage = canManageEvent(current, profile?.departmentId)
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

  async function handleAddImages(files: FileList | null) {
    if (!id || !files || files.length === 0) return
    const chosen = Array.from(files)
    // Checked up front so one bad file does not leave half the batch uploaded
    // and no explanation on screen.
    for (const file of chosen) {
      const image = checkImageFile(file)
      if (!image.ok) {
        setError(image.error)
        if (imageInputRef.current) imageInputRef.current.value = ''
        return
      }
    }
    setError('')
    setUploading(true)
    try {
      const urls: string[] = []
      for (const file of chosen) {
        urls.push(await uploadEventImage(id, file, Date.now()))
      }
      await patch({ images: [...current.images, ...urls] })
      setNotice(`Added ${urls.length} image${urls.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload those images.')
    } finally {
      setUploading(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
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
      // out from the missing report in the first place. Nothing else is written
      // — the status is decided by the date and the report from here on.
      await patch({
        report: url,
        reportName: file.name,
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

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="h-48 w-full sm:h-64">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <NoImage className="h-full w-full" label="No cover image for this event" />
          )}
        </div>

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
              cancelledReason={resolved.reason ?? current.cancelledReason ?? null}
            />
          </div>

          {current.description && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-600">
              {current.description}
            </p>
          )}
        </header>

        {(resolved.status === 'cancelled' || resolved.status === 'awaiting_report') && (
          <div className="px-6 pb-6">
            {resolved.status === 'cancelled' && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {CANCEL_REASON_LABELS[resolved.reason ?? current.cancelledReason ?? 'manual']}
              </p>
            )}

            {resolved.status === 'awaiting_report' && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                This event has finished and no report has been submitted. Upload a report
                within {REPORT_GRACE_DAYS} days, otherwise it will be cancelled automatically.
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
        {canManage && hasEnded && (
          <div className="mx-6 mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
            <h2 className="text-sm font-semibold text-gray-900">This event has finished</h2>
            <p className="mt-1 text-sm text-gray-600">
              {isManuallyCancelled
                ? 'Your department cancelled this event. Undo the cancellation if it did go ahead, then upload the report.'
                : 'Draft the write-up in the report maker, then upload it here to close this event off.'}
            </p>
            {/* The sentence above tells the teacher to go somewhere, so the
                somewhere has to be one click away here. It used to be named in
                prose only, and the actual link sat in the action bar at the
                bottom of the page — which is exactly where a teacher who has
                just been told to do something is not looking. */}
            <a
              href={REPORT_MAKER_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
            >
              <ExternalLink className="h-4 w-4" /> Open report maker
            </a>
          </div>
        )}

        {current.images.length > 0 && (
          <div className="border-t border-gray-100 p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Gallery</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {current.images.map((path, i) => {
                // Signed only once this tile has been asked to show it.
                const shown = media.urls[path]
                return (
                // The tile is not itself the button. A whole-tile target with
                // nothing to say it is a target reads as a thumbnail that failed
                // to load, and the label has to survive being read aloud.
                <div
                  key={path}
                  className="relative flex aspect-square flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-gray-200 p-2"
                >
                  {/* The photo is drawn inside its own tile rather than opened
                      over the page. A grid of photos is meant to be scanned, and
                      covering it with one enlarged image at a time means going
                      back through it one press at a time to see the rest. */}
                  {shown ? (
                    <>
                      <img
                        src={shown}
                        alt={`Photo ${i + 1} of this event`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      {/* The full-size link rides on the photo rather than
                          under it, so the tile keeps its size and nothing below
                          it moves when a photo appears. There is no way back to
                          the placeholder: a photo that has been asked for stays
                          shown, and the only thing left to do with it is open it
                          properly. */}
                      <a
                        href={shown}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open photo ${i + 1} at full size`}
                        className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-gray-700 transition hover:bg-white"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </>
                  ) : (
                    <>
                      <NoImage className="absolute inset-0 h-full w-full" label="" />
                      <span className="relative text-[11px] leading-tight text-gray-600">
                        Photo {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => void media.sign(path)}
                        disabled={!!media.pending[path]}
                        className="relative inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {media.pending[path] ? 'Loading…' : 'See'}
                      </button>
                    </>
                  )}
                </div>
                )
              })}
            </div>
            {media.error && <p className="mt-2 text-sm text-red-600">{media.error}</p>}
          </div>
        )}

        {current.report && (
          <div className="border-t border-gray-100 p-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Report</h2>
            <button
              type="button"
              onClick={() => {
                void media.sign(current.report as string).then((url) => {
                  if (url) window.open(url, '_blank', 'noopener,noreferrer')
                })
              }}
              disabled={!!media.pending[current.report]}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              {media.pending[current.report]
                ? 'Opening…'
                : (current.reportName ?? 'Open report')}
            </button>
            {media.error && <p className="mt-2 text-sm text-red-600">{media.error}</p>}
          </div>
        )}

        {canManage ? (
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
                <UserCheck className="h-3.5 w-3.5" /> Created by{' '}
                {event.coordinatorName ?? 'a teacher'}
              </span>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 border-t border-gray-100 p-6 text-xs text-gray-400">
            <UserCheck className="h-3.5 w-3.5" /> You can view this event, but editing it is
            limited to teachers in {department?.name ?? 'its department'}.
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
