/**
 * Validation for the event form, shared by CreateEvent and EditEvent.
 *
 * Two copies of these rules would drift, and the browser's own validation is
 * not enough on its own: `required` is satisfied by a run of spaces, and a
 * number input will happily hand back `1e3`, `3.5` or `-4` as strings that only
 * Postgres rejects later — as a cast error, in a message no one can act on.
 * So the rules are checked here, once, and the values come back trimmed and
 * normalised.
 */

export interface EventFormValues {
  title: string
  date: string
  startTime: string
  endTime: string
  venue: string
  description: string
  guestSpeaker: string
  /** Kept as a string: an empty box is a legitimate "not recorded". */
}

/** Normalised values, ready to send. */
export interface EventInput {
  title: string
  date: string
  startTime: string
  endTime: string
  venue: string
  description: string
  guestSpeaker: string | null
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Length caps. The columns are `text`, so Postgres will not stop a 40,000
 * character title — it would just wreck every card and row it lands in.
 */
export const LIMITS = {
  title: 120,
  venue: 120,
  guestSpeaker: 120,
  description: 2000,
} as const

/**
 * `<input type="time">` yields `HH:mm`, but with a step of 1 or 30 it can yield
 * seconds, and some browsers pad oddly. Accepted either way and normalised, so a
 * stray `09:30:00` does not end up stored in a `time` column as text.
 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Rejects a well-formed but impossible date such as 2026-02-31, which the input
 * type will not stop on its own. Postgres would store 3 March instead.
 *
 * Also requires a sane year. The date is parsed with a plain `yyyy-MM-dd` format
 * in eventStatus, and there is no event in this archive that predates the
 * institution keeping it.
 */
function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [, y, mo, d] = m.map(Number) as unknown as number[]
  if (y < 1900) return false
  const asDate = new Date(Date.UTC(y, mo - 1, d))
  return (
    asDate.getUTCFullYear() === y &&
    asDate.getUTCMonth() === mo - 1 &&
    asDate.getUTCDate() === d
  )
}

function boundedText(
  raw: string,
  label: string,
  max: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim()
  if (value.length > max) {
    return { ok: false, error: `${label} must be ${max} characters or fewer.` }
  }
  return { ok: true, value }
}

export function validateEvent(
  values: EventFormValues,
): Validated<EventInput> {
  const title = boundedText(values.title, 'Event name', LIMITS.title)
  if (!title.ok) return title
  if (title.value === '') return { ok: false, error: 'Event name is required.' }

  const venue = boundedText(values.venue, 'Venue', LIMITS.venue)
  if (!venue.ok) return venue
  if (venue.value === '') return { ok: false, error: 'Venue is required.' }

  const date = values.date.trim()
  if (!isRealDate(date)) {
    return { ok: false, error: 'Enter a real date, as YYYY-MM-DD.' }
  }

  const start = TIME_RE.exec(values.startTime.trim())
  if (!start) {
    return { ok: false, error: 'Enter a start time, as HH:MM.' }
  }
  const end = TIME_RE.exec(values.endTime.trim())
  if (!end) {
    return { ok: false, error: 'Enter an end time, as HH:MM.' }
  }

  const startTime = `${start[1]}:${start[2]}`
  const endTime = `${end[1]}:${end[2]}`
  // Both are zero-padded 24-hour values now, so this orders them correctly.
  if (endTime <= startTime) {
    return {
      ok: false,
      error:
        'End time must be after the start time. An event that runs past midnight ' +
        'should be split, or given an end time on the following day.',
    }
  }

  const guest = boundedText(values.guestSpeaker, 'Guest / speaker', LIMITS.guestSpeaker)
  if (!guest.ok) return guest

  const description = boundedText(
    values.description,
    'Description',
    LIMITS.description,
  )
  if (!description.ok) return description

  return {
    ok: true,
    value: {
      title: title.value,
      date,
      startTime,
      endTime,
      venue: venue.value,
      description: description.value,
      guestSpeaker: guest.value === '' ? null : guest.value,
    },
  }
}

/**
 * `accept="image/*"` is only a hint — a file can be renamed to `.png` on the way
 * in, and the browser will pass it straight through. Checked before the upload
 * so the refusal names the file rather than arriving as a storage error.
 */
export function checkImageFile(file: File): { ok: true } | { ok: false; error: string } {
  if (!file.type.startsWith('image/')) {
    return {
      ok: false,
      error: `"${file.name}" is not an image. Choose a JPG, PNG or WebP file.`,
    }
  }
  return { ok: true }
}

/** A report is a write-up, so it may be a document or a photo of one. */
const REPORT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt']
const REPORT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

/**
 * Matched on the extension as well as the MIME type, because Word files
 * routinely arrive with an empty or generic `type` depending on the browser and
 * the OS they were saved on.
 */
export function checkReportFile(file: File): { ok: true } | { ok: false; error: string } {
  const byExtension = REPORT_EXTENSIONS.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  )
  if (byExtension || REPORT_TYPES.includes(file.type) || file.type.startsWith('image/')) {
    return { ok: true }
  }
  return {
    ok: false,
    error: `A report must be a PDF, Word document, text file or image. "${file.name}" is not one.`,
  }
}
