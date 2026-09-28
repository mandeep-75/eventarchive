import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './client'

const BUCKET = 'event-media'

/** Signed URLs are temporary, so they are minted on demand rather than stored. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7

/**
 * Uploads land at `events/{eventId}/{uid}/{folder}/{file}`.
 *
 * The event id is segment 2, and that is the segment the storage policies read
 * to work out which department owns the file — so it must stay at index 2 and
 * must be the real event id. The uploader's own id follows it, taken from the
 * signed-in session rather than passed in, so a caller cannot file an upload
 * under someone else's folder.
 *
 * The returned value is the storage *path*, not a URL. The bucket is private so
 * that the "any signed-in teacher may read" rule in schema.sql actually applies;
 * render it through useSignedUrl (cover) or useOnDemandSigner (everything else).
 */
async function pathFor(eventId: string, folder: string, fileName: string) {
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) throw new Error('You must be signed in to upload files.')
  return `events/${eventId}/${uid}/${folder}/${fileName}`
}

/** Must match `file_size_limit` on the event-media bucket in schema.sql. */
const MAX_BYTES = 10 * 1024 * 1024

async function upload(
  file: File,
  eventId: string,
  folder: string,
  fileName: string,
): Promise<string> {
  // Checked before the request: Storage answers an oversized file with a bare
  // 400, which is indistinguishable from a permissions failure in the console.
  if (file.size > MAX_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
        `Files must be under ${MAX_BYTES / 1024 / 1024} MB — resize or compress it first.`,
    )
  }

  const path = await pathFor(eventId, folder, fileName)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    // Cover and gallery images replace any previous file at the same path.
    upsert: folder !== 'report',
    // Sent explicitly so a File with an empty or odd `type` still lands as an
    // image rather than application/octet-stream.
    contentType: file.type || 'image/jpeg',
  })
  if (error) {
    // Storage reports policy denials, missing buckets and oversize files all
    // as a bare "400". Keep the status so the cause is not lost.
    throw new Error(`${error.message} (storage ${error.status ?? 'error'})`)
  }
  return path
}

export function uploadCoverImage(eventId: string, file: File) {
  return upload(file, eventId, 'cover', 'cover.jpg')
}

export function uploadEventImage(eventId: string, file: File, stamp: number | string) {
  return upload(file, eventId, 'images', `${stamp}-${file.name}`)
}

export function uploadReport(eventId: string, file: File) {
  return upload(file, eventId, 'report', `${Date.now()}-${file.name}`)
}

export async function deleteImage(path: string) {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) throw error
  } catch {
    // Ignore missing files
  }
}

/** Turns a stored storage path into a temporary URL that can go in `src`. */
export async function signUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error) return null
  return data.signedUrl
}

/**
 * Signs a path when someone asks for it, rather than when the page loads.
 *
 * A gallery holds a dozen photos and a report is often a multi-page PDF, and the
 * storage policy lets any signed-in teacher read all of it — so signing a whole
 * event's media on arrival means every teacher who opens the page pulls every
 * file, whether or not they ever look at it. Nothing is fetched here either: this
 * only mints the URL, and the file itself is requested by whoever opens it.
 *
 * The cover is the deliberate exception, in `useSignedUrl` below. It is the one
 * image a list shows, so a card without it is not a card.
 *
 * Returns the URL rather than opening it, so the caller decides what "See" means:
 * a photo is shown in its own tile, and a report is handed to a new tab because a
 * document is not something to render inside a page.
 *
 * Results are cached by path for the life of the page, because a signature is
 * good for `SIGNED_URL_TTL` and re-opening the same photo should not ask again —
 * so a second view is immediate and never touches the network.
 *
 * `urls` holds everything signed so far, so a gallery tile can render the photo
 * it asked for without the component keeping its own copy. It is a map rather than
 * one string because a teacher can open several tiles in a row, and `pending` is a
 * map for the same reason: a single slot would make a second tile look idle while
 * the first was still loading, and clicking it would then be a no-op.
 */
export function useOnDemandSigner() {
  const cache = useRef<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  const sign = useCallback(async (path: string): Promise<string | null> => {
    const cached = cache.current[path]
    if (cached) return cached
    setError('')
    setPending((p) => ({ ...p, [path]: true }))
    try {
      const url = await signUrl(path)
      if (!url) {
        setError(
          'That file could not be opened. It may have been removed, or you may not have access.',
        )
        return null
      }
      cache.current[path] = url
      setUrls((u) => ({ ...u, [path]: url }))
      return url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be opened.')
      return null
    } finally {
      setPending((p) => {
        const next = { ...p }
        delete next[path]
        return next
      })
    }
  }, [])

  return { sign, urls, pending, error }
}

/**
 * Signs one path for display.
 *
 * The result is keyed by the path it was signed for, so switching to a different
 * event cannot briefly show the previous event's image while the new signature
 * is in flight. Nothing is set synchronously: the URL is only committed once the
 * signature actually arrives.
 */
export function useSignedUrl(path: string | null | undefined) {
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    void signUrl(path).then((url) => {
      if (!cancelled && url) setSigned({ path, url })
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return signed && signed.path === path ? signed.url : null
}
