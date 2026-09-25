import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Upload } from 'lucide-react'
import { createEvent } from '../supabase/data'
import { uploadCoverImage } from '../supabase/storage'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { resolveStatus } from '../lib/eventStatus'

export default function CreateEvent() {
  const { user, profile } = useAuth()
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  // A teacher files under their own department and nowhere else, so this is
  // read from the profile rather than chosen.
  const departmentId = profile?.departmentId ?? null
  const ownDepartment = departmentId ? getDepartment(departmentId) : undefined
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [venue, setVenue] = useState('')
  const [description, setDescription] = useState('')
  const [guestSpeaker, setGuestSpeaker] = useState('')
  const [participantCount, setParticipantCount] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    const reader = new FileReader()
    reader.onload = () => setCoverPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Any date is allowed; the status is worked out from it rather than chosen.
  const projectedStatus =
    date && startTime && endTime
      ? resolveStatus({ date, startTime, endTime, report: null, status: 'upcoming' }).status
      : null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setError('')

    if (!departmentId) {
      setError(
        'Your account is not in a department yet. Ask a manager to assign you one, then create the event.',
      )
      return
    }

    if (endTime <= startTime) {
      setError('End time must be after the start time')
      return
    }

    setSubmitting(true)
    try {
      // Minted here, not by the database, because the cover is uploaded before
      // the row exists and both need the same id. Must be a full UUID to match
      // the events.id column type.
      const eventId = crypto.randomUUID()

      let coverUrl: string | null = null
      if (coverFile) {
        coverUrl = await uploadCoverImage(eventId, coverFile)
      }

      const participants = participantCount.trim()
        ? Number(participantCount)
        : undefined

      await createEvent({
        title,
        departmentId,
        date,
        startTime,
        endTime,
        venue,
        description,
        // Derived from the chosen date so a back-dated event is never filed as upcoming.
        status: projectedStatus ?? 'upcoming',
        coverImage: coverUrl,
        images: [],
        coordinatorId: user.id,
        guestSpeaker: guestSpeaker.trim() || null,
        participantCount: Number.isFinite(participants) ? participants : undefined,
        // created_at and updated_at are set by the database.
        id: eventId,
      })

      navigate('/events')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Create Event</h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div>
          <label htmlFor="ev-title" className="mb-1 block text-sm font-medium text-gray-700">
            Event Name *
          </label>
          <input
            id="ev-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Cybersecurity Workshop"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Department</span>
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              {ownDepartment
                ? `Filed under ${ownDepartment.name}, your department.`
                : 'You are not in a department yet, so you cannot create events.'}
            </p>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              {projectedStatus
                ? `Will be “${projectedStatus}” based on the date. It updates automatically as time passes.`
                : 'Set a date to see the status. It is worked out automatically.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ev-date" className="mb-1 block text-sm font-medium text-gray-700">
              Date *
            </label>
            <input
              id="ev-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label htmlFor="ev-start" className="mb-1 block text-sm font-medium text-gray-700">
              Start Time *
            </label>
            <input
              id="ev-start"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label htmlFor="ev-end" className="mb-1 block text-sm font-medium text-gray-700">
              End Time *
            </label>
            <input
              id="ev-end"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ev-venue" className="mb-1 block text-sm font-medium text-gray-700">
            Venue *
          </label>
          <input
            id="ev-venue"
            type="text"
            required
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. Seminar Hall"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ev-speaker" className="mb-1 block text-sm font-medium text-gray-700">
              Guest / Speaker
            </label>
            <input
              id="ev-speaker"
              type="text"
              value={guestSpeaker}
              onChange={(e) => setGuestSpeaker(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label htmlFor="ev-participants" className="mb-1 block text-sm font-medium text-gray-700">
              Participants
            </label>
            <input
              id="ev-participants"
              type="number"
              min={0}
              value={participantCount}
              onChange={(e) => setParticipantCount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ev-desc" className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="ev-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the event…"
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Cover Image</span>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-gray-300 p-4 transition hover:border-indigo-400 hover:bg-indigo-50/50">
            {coverPreview ? (
              <img src={coverPreview} alt="" className="h-20 w-20 rounded object-cover" />
            ) : (
              <Upload className="h-5 w-5 text-gray-400" />
            )}
            <span className="text-sm text-gray-500">
              {coverFile ? coverFile.name : 'Click to upload cover image'}
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
            onClick={() => navigate(-1)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </form>
    </div>
  )
}
