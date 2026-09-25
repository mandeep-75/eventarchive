import { useEffect, useMemo, useState } from 'react'
import { supabase } from './client'

const BUCKET = 'event-media'

/** Signed URLs are temporary, so they are minted on demand rather than stored. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 7

/**
 * Uploads land at `events/{eventId}/{uid}/{folder}/{file}`.
 *
 * The uploader's own id is part of the path and is taken from the signed-in
 * session rather than passed in, so a caller cannot file an upload under
 * someone else's folder. The storage policies in supabase/schema.sql cannot
 * read the events table to check ownership, so this path segment is what they
 * match on.
 *
 * The returned value is the storage *path*, not a URL. The bucket is private so
 * that the "any signed-in teacher may read" rule in schema.sql actually applies;
 * render it through useSignedUrl / useSignedUrls below.
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

/** Same, for a gallery: signs every path and returns a path-keyed map. */
export function useSignedUrls(paths: string[]) {
  const key = paths.join('\u0000')
  const list = useMemo(() => (key ? key.split('\u0000') : []), [key])
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!list.length) return
    let cancelled = false
    void Promise.all(list.map(async (p) => [p, await signUrl(p)] as const)).then(
      (pairs) => {
        if (cancelled) return
        setUrls(
          Object.fromEntries(pairs.filter((pair): pair is [string, string] => !!pair[1])),
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [list])

  return urls
}