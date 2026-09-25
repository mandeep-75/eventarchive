import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Info, Upload } from 'lucide-react'
import { getEvent, updateEvent } from '../supabase/data'
import { uploadCoverImage } from '../supabase/storage'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { isEventOwner } from '../lib/ownership'
import { resolveStatus } from '../lib/eventStatus'

export default function EditEvent() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  const [loadingEvent, setLoadingEvent] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [title, setTitle] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [venue, setVenue] = useState('')
  const [description, setDescription] = useState('')
  const [guestSpeaker, setGuestSpeaker] = useState('')
  const [participantCount, setParticipantCount] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [existingCover, setExistingCover] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    getEvent(id).then((e) => {
      if (!e) {
        setNotFound(true)
        setLoadingEvent(false)
        return
      }
      if (!isEventOwner(e, user?.id)) {
        setForbidden(true)
        setLoadingEvent(false)
        return
      }
      setTitle(e.title)
      setDepartmentId(e.departmentId)
      setDate(e.date)
      setStartTime(e.startTime)
      setEndTime(e.endTime)
      setVenue(e.venue)
      setDescription(e.description)
      setGuestSpeaker(e.guestSpeaker ?? '')
      setParticipantCount(
        e.participantCount !== undefined ? String(e.participantCount) : '',
      )
      setExistingCover(e.coverImage)
      setLoadingEvent(false)
    })
  }, [id, user?.id])

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    const reader = new FileReader()
    reader.onload = () => setCoverPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const projectedStatus =
    date && startTime && endTime
      ? resolveStatus({ date, startTime, endTime, report: null, status: 'upcoming' }).status
      : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setError('')

    if (endTime <= startTime) {
      setError('End time must be after the start time')
      return
    }

    setSubmitting(true)
    try {
      let coverUrl = existingCover
      if (coverFile) {
        coverUrl = await uploadCoverImage(id, coverFile)
      }

      const participants = participantCount.trim()
        ? Number(participantCount)
        : undefined

      // departmentId is deliberately absent: it is fixed at creation, and the
      // events_pin_immutable trigger rejects any attempt to change it.
      await updateEvent(id, {
        title,
        date,
        startTime,
        endTime,
        venue,
        description,
        coverImage: coverUrl,
        guestSpeaker: guestSpeaker.trim() || null,
        participantCount: Number.isFinite(participants) ? participants : null,
      })

      navigate(`/events/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingEvent) {
    return <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
  }

  if (forbidden || notFound) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <h1 className="text-lg font-bold text-gray-900">
            {notFound ? 'Event not found' : 'You cannot edit this event'}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {notFound
              ? 'It may have been deleted.'
              : 'Only the teacher who created an event can change it. You can still view it.'}
          </p>
        </div>
        <div className="text-center">
          <button
            onClick={() => navigate(id ? `/events/${id}` : '/events')}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {notFound ? 'Back to events' : 'Back to event'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Edit Event</h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label htmlFor="ed-title" className="mb-1 block text-sm font-medium text-gray-700">
            Event Name *
          </label>
          <input
            id="ed-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Department</span>
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              {getDepartment(departmentId)?.name
                ? `Filed under ${getDepartment(departmentId)?.name}. An event cannot be moved to another department.`
                : 'This event has no department. Ask a manager to correct it.'}
            </p>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              {projectedStatus
                ? `Will be “${projectedStatus}” based on the date, or cancelled if no report is uploaded.`
                : 'Worked out automatically from the date.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ed-date" className="mb-1 block text-sm font-medium text-gray-700">
              Date *
            </label>
            <input
              id="ed-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label htmlFor="ed-start" className="mb-1 block text-sm font-medium text-gray-700">
              Start Time *
            </label>
            <input
              id="ed-start"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label htmlFor="ed-end" className="mb-1 block text-sm font-medium text-gray-700">
              End Time *
            </label>
            <input
              id="ed-end"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ed-venue" className="mb-1 block text-sm font-medium text-gray-700">
            Venue *
          </label>
          <input
            id="ed-venue"
            type="text"
            required
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ed-speaker" className="mb-1 block text-sm font-medium text-gray-700">
              Guest / Speaker
            </label>
            <input
              id="ed-speaker"
              type="text"
              value={guestSpeaker}
              onChange={(e) => setGuestSpeaker(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label
              htmlFor="ed-participants"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Participants
            </label>
            <input
              id="ed-participants"
              type="number"
              min={0}
              value={participantCount}
              onChange={(e) => setParticipantCount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ed-desc" className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="ed-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Cover Image</span>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 transition hover:border-indigo-400 hover:bg-indigo-50/50">
            {coverPreview || existingCover ? (
              <img
                src={coverPreview ?? existingCover ?? ''}
                alt=""
                className="h-20 w-20 rounded object-cover"
              />
            ) : (
              <Upload className="h-5 w-5 text-gray-400" />
            )}
            <span className="text-sm text-gray-500">
              {coverFile ? coverFile.name : 'Click to change cover image'}
            </span>
            <input type="file" accept="image/*" onChange={handleCoverChange} className="hidden" />
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/events/${id}`)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>

      <p className="text-xs text-gray-400">
        Filed under {getDepartment(departmentId)?.name ?? 'unknown department'}.
      </p>
    </div>
  )
}
