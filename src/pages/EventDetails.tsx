import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Clock,
  FileText,
  ImagePlus,
  Images,
  MapPin,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  UserCheck,
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
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/events"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {notice && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{notice}</p>
      )}

      <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {coverUrl && (
          <div className="h-56 w-full bg-gray-100 sm:h-72">
            <img
              src={coverUrl}
              alt={current.title}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="space-y-6 p-6">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-indigo-600">
                {department?.name ?? 'Unknown department'}
              </span>
              <EventStatus
                status={resolved.status}
                pendingReport={resolved.pendingReport}
                cancelledReason={resolved.reason ?? current.cancelledReason ?? null}
              />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{current.title}</h1>
            <p className="mt-1 text-xs text-gray-400">
              Status is worked out from the date and whether a report was submitted.
            </p>
          </div>

          {resolved.status === 'cancelled' && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {CANCEL_REASON_LABELS[resolved.reason ?? current.cancelledReason ?? 'manual']}
            </p>
          )}

          {resolved.pendingReport && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              This event has finished and no report has been submitted. Upload a report
              before the 7 day grace period ends, otherwise it will be cancelled
              automatically.
            </p>
          )}

          {isOwner && hasEnded && (
            <section className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
              <h2 className="text-sm font-semibold text-gray-900">This event has finished</h2>
              <p className="mt-1 text-sm text-gray-600">
                {isManuallyCancelled
                  ? 'You cancelled this event. Undo the cancellation if it did go ahead, then upload the report.'
                  : 'Close it off by uploading the report, or cancel it if it did not go ahead.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!isManuallyCancelled && (
                  <button
                    onClick={() => reportInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {current.report ? 'Replace report' : 'Upload report to complete'}
                  </button>
                )}
                {isManuallyCancelled ? (
                  <button
                    onClick={handleRestore}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    <RotateCcw className="h-4 w-4" /> Undo cancel
                  </button>
                ) : (
                  <button
                    onClick={handleCancel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                  >
                    <Ban className="h-4 w-4" /> Cancel event
                  </button>
                )}
                {uploading && <span className="text-sm text-gray-400">Uploading…</span>}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Info
              icon={<CalendarDays className="h-4 w-4" />}
              label="Date"
              value={dateLabel}
            />
            <Info
              icon={<Clock className="h-4 w-4" />}
              label="Time"
              value={`${current.startTime} – ${current.endTime}`}
            />
            <Info icon={<MapPin className="h-4 w-4" />} label="Venue" value={current.venue} />
          </div>

          {current.description && (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-gray-700">About this event</h2>
              <p className="whitespace-pre-line text-gray-600">{current.description}</p>
            </div>
          )}

          {(current.guestSpeaker || current.participantCount !== undefined) && (
            <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
              {current.guestSpeaker && (
                <p className="mb-1">
                  <span className="font-medium text-gray-700">Guest / Speaker:</span>{' '}
                  {current.guestSpeaker}
                </p>
              )}
              {current.participantCount != null && (
                <p>
                  <span className="font-medium text-gray-700">Participants:</span>{' '}
                  {current.participantCount}
                </p>
              )}
            </div>
          )}

          {isOwner ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
              <Link
                to={`/events/${current.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                <Pencil className="h-4 w-4" /> Edit
              </Link>

              {/* After the event ends these live in the "has finished" panel. */}
              {!hasEnded &&
                (isManuallyCancelled ? (
                  <button
                    onClick={handleRestore}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Undo cancel
                  </button>
                ) : (
                  <button
                    onClick={handleCancel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                  >
                    <Ban className="h-4 w-4" /> Cancel event
                  </button>
                ))}

              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>

              <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                <UserCheck className="h-3.5 w-3.5" /> You created this
              </span>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 border-t border-gray-100 pt-4 text-xs text-gray-400">
              <UserCheck className="h-3.5 w-3.5" /> You can view this event but not edit
              it — only its creator can.
            </p>
          )}

          {(current.images.length > 0 || current.report || isOwner) && (
            <div className="border-t border-gray-100 pt-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Images className="h-4 w-4" /> Event Gallery & Report
              </h2>

              {signedGallery.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {signedGallery.map(([path, src], i) => (
                    <img
                      key={path}
                      src={src}
                      alt={`${current.title} ${i + 1}`}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}

              {current.report && reportUrl && (
                <a
                  href={reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  <FileText className="h-4 w-4" />
                  {current.reportName ?? 'Download Report'}
                </a>
              )}

              {isOwner && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <ImagePlus className="h-4 w-4" /> Add Images
                  </button>
                  {!hasEnded && (
                    <button
                      onClick={() => reportInputRef.current?.click()}
                      disabled={uploading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
                    >
                      <Upload className="h-4 w-4" /> Upload Report
                    </button>
                  )}
                  {uploading && <span className="text-sm text-gray-400">Uploading…</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </article>

      {/* Kept outside the gallery section so both triggers always have them. */}
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

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
      <span className="mt-0.5 text-indigo-600">{icon}</span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-800">{value}</p>
      </div>
    </div>
  )
}
